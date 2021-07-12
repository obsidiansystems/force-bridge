import { WalletServer, AddressWallet, Transaction } from 'cardano-wallet-js';
import { createConnection } from 'typeorm';
import { ForceBridgeCore } from '../../core';
import { AdaDb } from '../../db/ada';
import { AdaLockStatus } from '../../db/entity/AdaLock';
import { AdaUnlock } from '../../db/entity/AdaUnlock';
import { logger } from '../../utils/logger';
import { AdaLockData, AdaUnlockResult, IInput, IOutput } from '../../xchain/ada/type';
let walletServer;
const CkbTxHashLen = 64;
const log = console.log;

export type AdaTransaction = {
  id: string;
  amount: any;
  fee: any;
  deposit: any;
  direction: any;
  inserted_at: any;
  expires_at: any;
  pending_since: any;
  depth: any;
  inputs: Array<any>;
  outputs: Array<any>;
  withdrawals: Array<any>;
  mint: Array<any>;
  status: AdaLockStatus;
  metadata: any;
};
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
    //get all pending status events from db
    const conn = await createConnection();
    const adaDb = new AdaDb(conn);

    const records = await adaDb.getAdaLockRecords('pending');
    if (records.length == 0) {
      log('no pending events to watch from...');
      return;
    } else {
      //checking the status of those id;
      const transactionDetails = await this.getTransactionDetailsFromId(records[0].sender, records[0].txid);

      log({ transactionDetails });
      if (transactionDetails.status == 'in_ledger') {
        // status has been changed for transction.
        log('Event has been changes....');
        await adaDb.updateAdaLockRecords(transactionDetails.id, transactionDetails.status);
        if (records[0].sender == ForceBridgeCore.config.ada.wallet.public_key) {
          //matching account id
          //todo
          //if sender is our address , we need to trigger ckb burn
          const ckbBurnTxHashes: string[] = await this.getUnlockTxData(
            transactionDetails.inputs,
            transactionDetails.outputs,
          );
          log(
            `verify for unlock event. transaction ${transactionDetails.id} tx . find ckb burn hashes:  ${ckbBurnTxHashes}`,
          );
          for (let i = 0; i < ckbBurnTxHashes.length; i++) {
            await handleUnlockAsyncFunc(ckbBurnTxHashes[i]);
          }
        } else {
          //if sender address is not our address then we need to trigger ckb mint
          const data: AdaLockData = {
            txId: records[0].txid,
            amount: records[0].amount,
            data: records[0].data,
            sender: records[0].sender,
            status: transactionDetails.status,
          };
          log(`verify for lock event. ada lock data: ${JSON.stringify(data, null, 2)}`);
          await handleLockAsyncFunc(data);
        }
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
    log(`lock tx params: amount ${amount}.`);
    //need to lock the amount using transaction and then sign the transaction.

    //need to fetch the amount before locking the amount.
    const wallet = await walletServer.getShelleyWallet(id);
    log({ wallet });
    const totalBalance = await wallet.getAvailableBalance();
    log({ totalBalance });
    try {
      // receiver address
      //checking if the amount is good to proceed with or not
      const address = new AddressWallet(ForceBridgeCore.config.ada.lockAddress);
      const estimatedFees = await wallet.estimateFee([address], [amount]);
      log(`Transaction fee for locking the amount ${amount} ada is : ${estimatedFees}`);
      log({ estimatedFees });
    } catch (e) {
      log({ e });
      throw new Error('Insufficient balance..');
    }

    // receiver address
    const addresses = [new AddressWallet(ForceBridgeCore.config.ada.lockAddress)];
    const amounts = [amount];

    const transaction: any = await wallet.sendPayment(passphrase, addresses, amounts);
    log(`user lock ${amount} ada; transactions details are ${transaction}`);

    //need to create a record with cardano transaction status
    const conn = await createConnection();
    const adaDb = new AdaDb(conn);
    await adaDb.createAdaLock([
      {
        txid: transaction.id,
        sender: id,
        amount: amount,
        data: '',
        status: 'pending',
      },
    ]);
    conn.close();
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
    log('database records which need exec unlock:', records);
    //fetch balance from locked wallet
    const wallet = await walletServer.getShelleyWallet(ForceBridgeCore.config.ada.wallet.public_key);
    const balance = await wallet.getAvailableBalance();
    log(`collect live balance: ${JSON.stringify(balance, null, 2)}`);

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
      log(`Transaction fee for Unlocking the transaction is : ${estimatedFees}`);
      log({ estimatedFees });

      const transaction: any = await wallet.sendPayment(
        ForceBridgeCore.config.ada.wallet.passphrase,
        accounts,
        amounts,
      );
      log(`user Unlock ada; transactions details are ${transaction}`);
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
        log(`verify op return output data : ${voutPubkeyHex}`);
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

  async getTransactionDetailsFromId(id, transactionId): Promise<AdaTransaction> {
    const wallet = await walletServer.getShelleyWallet(id);
    const transaction = await wallet.getTransaction(transactionId);
    console.log({ transaction });
    return transaction;
  }
}
