import { Account } from '@force-bridge/x/dist/ckb/model/accounts';
import { AdaAsset } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { logger } from '@force-bridge/x/dist/utils/logger';
import { ADAChain } from '@force-bridge/x/dist/xchain/ada';
import { Amount } from '@lay2/pw-core';
import commander from 'commander';
import { getSudtBalance, parseOptions, waitUnlockTxCompleted } from './utils';
export const adaCmd = new commander.Command('ada');

adaCmd
  .command('unlock')
  .requiredOption('-r, --recipient', 'recipient address on ada')
  .requiredOption('-p, --privateKey', 'private key of unlock address on ckb')
  .requiredOption('-a, --amount', 'amount of unlock. unit is ada')
  .action(doUnlock)
  .description('unlock asset on ada');

adaCmd
  .command('lock')
  .requiredOption('-id, --id', 'id of the locked account')
  .requiredOption('-p, --passphrase', 'passphrase of the locked account')
  .requiredOption('-u, --userAddr', 'address on cardao blockchain')
  .requiredOption('-a, --amount', 'amount to lock')
  .requiredOption('-r, --recipient', 'recipient address on ckb')
  .action(doLock)
  .description('lock asset on ADA');

adaCmd
  .command('balanceOf')
  .requiredOption('-id, --id', 'id of the account')
  .requiredOption('-a, --address', 'address on ada or ckb')
  .option('-o, --origin', 'whether query balance on ada')
  .action(doBalanceOf)
  .description('query balance of address on ada or ckb');

async function doLock(
  opts: {
    mnemonics: boolean;
    passphrase: boolean;
    name: boolean;
    userAddr: boolean;
    amount: boolean;
    recipient: boolean;
    extra?: boolean;
    feeRate?: boolean;
    wait?: boolean;
  },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const id = options.get('id');
  const passphrase = options.get('passphrase');
  const amount = options.get('amount');
  const userAddr = options.get('userAddr');
  const adaChain = new ADAChain();
  const lockTxId = await adaChain.sendLockTxs(id, parseFloat(amount), passphrase);
  logger.debug(`user ${userAddr} lock ${amount} ada. the lock tx id is ${lockTxId}`);

  if (opts.wait) {
    const wallet = await createWallet(id);
    while (true) {
      await asyncSleep(3000);
      const txOut = await wallet.getTransaction(lockTxId);
      if (txOut.status == 'in_ledger') {
        console.log(txOut);
        break;
      }
    }
    console.log('Lock success.');
  }
}

/**
 * Unlock command to free lock ada and send that to recipient account.
 * @param opts
 * @param command , e.g- ada
 */
async function doUnlock(
  opts: { recipient: boolean; privateKey: boolean; amount: boolean; wait?: boolean },
  command: commander.Command,
) {
  const options = parseOptions(opts, command);
  const recipientAddress = options.get('recipient');
  const privateKey = options.get('privateKey');
  const amount = options.get('amount');

  const account = new Account(privateKey);
  const generator = new CkbTxGenerator(ForceBridgeCore.ckb, new IndexerCollector(ForceBridgeCore.indexer));
  const burnAmount = new Amount(amount, 0);
  const burnTx = await generator.burn(
    await account.getLockscript(),
    recipientAddress.toString(),
    new AdaAsset('ada', ForceBridgeCore.config.ckb.ownerLockHash),
    burnAmount,
  );
  const signedTx = ForceBridgeCore.ckb.signTransaction(privateKey)(burnTx);
  const burnTxHash = await ForceBridgeCore.ckb.rpc.sendTransaction(signedTx);
  console.log(
    `Address:${account.address} unlock ${amount} , recipientAddress:${recipientAddress}, burnTxHash:${burnTxHash}`,
  );

  if (opts.wait) {
    await waitUnlockTxCompleted(burnTxHash);
  }
}

/**
 * fetch balance of cardano wallet and also sudt account
 * @param opts
 * @param command
 */
async function doBalanceOf(opts: { address: boolean; id: boolean; origin?: boolean }, command: commander.Command) {
  const options = parseOptions(opts, command);
  const id = options.get('id');
  const address = options.get('address');
  if (opts.origin) {
    const wallet = await createWallet(id);
    const totalBalance = wallet.getAvailableBalance();
    console.log(`BalanceOf on ADA is ${totalBalance} ada`);
    return totalBalance;
  }

  const asset = new AdaAsset('ada', ForceBridgeCore.config.ckb.ownerLockHash);
  const balance = await getSudtBalance(address, asset);
  console.log(`BalanceOf address:${address} on ckb is ${balance} ada`);
}

/**
 * Generic function to fetch wallet details from id
 * @param id , id of the wallet to fetch details
 */
async function createWallet(id) {
  const adaChain = new ADAChain();
  return adaChain.createWallet(id);
}
