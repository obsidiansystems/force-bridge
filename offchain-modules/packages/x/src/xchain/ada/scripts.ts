import { WalletServer, AddressWallet } from 'cardano-wallet-js';
import { ForceBridgeCore } from '../../core';
import { AdaUnlock } from '../../db/entity/AdaUnlock';
import { logger } from '../../utils/logger';
import { AdaLockData, AdaUnlockResult, IInput, IOutput } from '../../xchain/ada/type';

let walletServer;
const CkbTxHashLen = 64;
export class ADAChain {
  protected readonly config;
  constructor() {
    const config = ForceBridgeCore.config.ada;
    const clientParams = config.clientParams;
    walletServer = WalletServer.init(`http://${clientParams.url}:${clientParams.port}/v2`);
    this.config = config;
  }

  /**
   * Need to watch ada chain to get transactions details,
   * if sender is main account holder then we need to trigger handleUnlockAsyncFunc,
   * else handleLockAsyncFunc
   * @param handleLockAsyncFunc
   * @param handleUnlockAsyncFunc
   */
  async watchAdaTxEvents(handleLockAsyncFunc, handleUnlockAsyncFunc) {
    //get all transactions
    const wallet = await walletServer.getShelleyWallet(ForceBridgeCore.config.ada.wallet.public_key);
    const transactions = await wallet.getTransactions();
    for (let i = 0; i < transactions.length; i++) {
      //if out is our address and transaction status is "in_ledger" then call handle LockAsync Function
      const ckbBurnTxHashes: string[] = await this.getUnlockTxData(transactions[i].inputs, transactions[i].outputs);
      if (ckbBurnTxHashes.length != 0) {
        logger.debug(
          `verify for unlock event. transaction ${transactions[i].id} tx . find ckb burn hashes:  ${ckbBurnTxHashes}`,
        );
        for (let i = 0; i < ckbBurnTxHashes.length; i++) {
          await handleUnlockAsyncFunc(ckbBurnTxHashes[i]);
        }
      }
      if (this.isLockTx(transactions[i].outputs)) {
        const data: AdaLockData = {
          txId: transactions[i].txid,
          amount: transactions[i].amount.quantity,
          data: transactions[i].metadata.join(''),
          sender: transactions[i].outputs[0].address,
        };
        logger.debug(`verify for lock event. btc lock data: ${JSON.stringify(data, null, 2)}`);
        await handleLockAsyncFunc(data);
      }
    }
  }

  /**
   * Locking the asset on ada,sending it to the locked wallet
   * @param {string} id, wallet id to get wallet details
   * @param {number} amount, amount to be send to other wallet
   * @param {string} passphrase, to import wallet so that we can send payment as authorized personal
   */
  async sendLockTxs(id: string, amount: number, passphrase: string): Promise<string> {
    logger.debug(`lock tx params: amount ${amount}.`);
    //need to lock the amount using transaction and then sign the transaction.

    //need to fetch the amount before locking the amount.
    const wallet = await walletServer.getShelleyWallet(id);
    try {
      // receiver address
      //checking if the amount is good to proceed with or not
      const address = new AddressWallet(ForceBridgeCore.config.ada.lockAddress);
      const estimatedFees = await wallet.estimateFee([address], [amount]);
      logger.debug(`Transaction fee for locking the amount ${amount} ada is : ${estimatedFees}`);
      console.log({ estimatedFees });
    } catch (e) {
      throw new Error('Insufficient balance..');
    }

    // receiver address
    const addresses = [new AddressWallet(ForceBridgeCore.config.ada.lockAddress)];
    const amounts = [amount];

    const transaction: any = await wallet.sendPayment(passphrase, addresses, amounts);
    logger.debug(`user lock ${amount} ada; transactions details are ${transaction}`);
    return transaction.id;
  }

  /**
   * Unlocking the asset on ada, and sending back to the client
   * @param records
   */
  async sendUnlockTxs(records: AdaUnlock[]): Promise<AdaUnlockResult> {
    if (records.length === 0) {
      throw new Error('the unlock records should not be null');
    }
    if (records.length > 2) {
      throw new Error('the limit of op_return output size is 80 bytes which can contain 2 ckb tx hash (32*2 bytes)');
    }
    logger.debug('database records which need exec unlock:', records);
    //fetch balance from locked wallet
    const wallet = await walletServer.getShelleyWallet(ForceBridgeCore.config.ada.wallet.public_key);
    const balance = wallet.getAvailableBalance();
    logger.debug(`collect live utxos for unlock: ${JSON.stringify(balance, null, 2)}`);

    //need to fetch record from database, burnt the balance on CKB and release the token on ada chain.
    const accounts = [];
    const amounts = [];
    records.map((r) => {
      accounts.push(new AddressWallet(r.recipientAddress));
      amounts.push(r.amount);
    });

    try {
      // receiver address
      //checking if the amount is good to proceed with or not
      const estimatedFees = await wallet.estimateFee(accounts, amounts);
      logger.debug(`Transaction fee for Unlocking the transaction is : ${estimatedFees}`);
      console.log({ estimatedFees });

      const transaction: any = await wallet.sendPayment(
        ForceBridgeCore.config.ada.wallet.passphrase,
        accounts,
        amounts,
      );
      logger.debug(`user Unlock ada; transactions details are ${transaction}`);
      return transaction.id;
    } catch (e) {
      throw new Error('Insufficient balance..');
    }
  }

  /**
   * Checking unlock transaction data , that we have send the amount to the initial user
   * @param txInputs , inputs to the transaction
   * @param txOutput output to the transaction
   */
  async getUnlockTxData(txInputs: IInput[], txOutput: IOutput[]): Promise<string[]> {
    if (!(await this.isAddressInInput(txInputs, ForceBridgeCore.config.ada.lockAddress)) || txOutput.length < 2) {
      return [];
    }
    const waitVerifyTxVouts = txOutput.slice(1);
    for (let i = 0; i < waitVerifyTxVouts.length; i++) {
      const voutPubkeyHex = waitVerifyTxVouts[i].address;
      if (voutPubkeyHex) {
        logger.debug(`verify op return output data : ${voutPubkeyHex}`);
        return this.splitTxhash(voutPubkeyHex);
      }
    }
    return [];
  }

  /**
   * checking if the main account is the sender that means, trigger the unlock event.
   * @param inputs , inouts that are supposed to be initiating the transaction
   * @param address , main account address
   */
  async isAddressInInput(inputs: IInput[], address: string): Promise<boolean> {
    if (inputs.length === 0) {
      return false;
    }
    for (let i = 0; i < inputs.length; i++) {
      if (address === inputs[i].address) {
        return true;
      }
    }
    return false;
  }

  splitTxhash(burnHashesStr: string): string[] {
    if (burnHashesStr.length % CkbTxHashLen != 0) {
      return [];
    }
    let index = 0;
    const burnHashes = [];
    while (index < burnHashesStr.length) {
      burnHashes.push(burnHashesStr.slice(index, (index += CkbTxHashLen)));
    }
    return burnHashes;
  }

  //checking if the transaction has main locked wallet address as output
  isLockTx(txOutputs: IOutput[]): boolean {
    if (txOutputs.length < 2) {
      return false;
    }
    const firstOutputAddr = txOutputs[0].address;

    return firstOutputAddr === ForceBridgeCore.config.ada.lockAddress;
  }

  async createWallet(id) {
    const wallet = await walletServer.getShelleyWallet(id);
    return wallet;
  }
}
