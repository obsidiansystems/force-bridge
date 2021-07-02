import assert from 'assert';
import { Account } from '@force-bridge/x/dist/ckb/model/accounts';
import { AdaAsset, ChainType } from '@force-bridge/x/dist/ckb/model/asset';
import { IndexerCollector } from '@force-bridge/x/dist/ckb/tx-helper/collector';
import { CkbTxGenerator } from '@force-bridge/x/dist/ckb/tx-helper/generator';
import { CkbIndexer } from '@force-bridge/x/dist/ckb/tx-helper/indexer';
import { Config } from '@force-bridge/x/dist/config';
import { ForceBridgeCore } from '@force-bridge/x/dist/core';
import { AdaDb } from '@force-bridge/x/dist/db/ada';
import { AdaLock } from '@force-bridge/x/dist/db/entity/AdaLock';
import { AdaUnlock } from '@force-bridge/x/dist/db/entity/AdaUnlock';
import { CkbMint } from '@force-bridge/x/dist/db/entity/CkbMint';
import { asyncSleep } from '@force-bridge/x/dist/utils';
import { logger, initLog } from '@force-bridge/x/dist/utils/logger';
import { ADAChain } from '@force-bridge/x/dist/xchain/ada';
import { Amount, Script } from '@lay2/pw-core';
import CKB from '@nervosnetwork/ckb-sdk-core';
import { WalletServer, AddressWallet, TransactionWallet } from 'cardano-wallet-js';
import nconf from 'nconf';
import { createConnection } from 'typeorm';
import { waitFnCompleted, waitUntilCommitted } from './util';
// const CKB = require('@nervosnetwork/ckb-sdk-core').default;

const CKB_URL = process.env.CKB_URL || 'http://127.0.0.1:8114';
const CKB_INDEXER_URL = process.env.CKB_INDEXER_URL || 'http://127.0.0.1:8116';
const indexer = new CkbIndexer(CKB_URL, CKB_INDEXER_URL);
const collector = new IndexerCollector(indexer);
const ckb = new CKB(CKB_URL);

async function main() {
  logger.debug('start ada test lock and unlock');

  const conn = await createConnection();
  const adaDb = new AdaDb(conn);

  const configPath = process.env.CONFIG_PATH || './config.json';
  nconf.env().file({ file: configPath });
  const config: Config = nconf.get('forceBridge');
  config.common.log.logFile = './log/ada-ci.log';
  initLog(config.common.log);

  // init bridge force core
  await new ForceBridgeCore().init(config);

  logger.debug(`config: ${config}`);
  const PRI_KEY = ForceBridgeCore.config.ckb.privateKey;
  const client = WalletServer.init(
    `http://${ForceBridgeCore.config.ada.clientParams.url}:${ForceBridgeCore.config.ada.clientParams.port}/v2`,
  );
  const wallet = await client.getShelleyWallet(ForceBridgeCore.config.ada.user.public_key);
  const adaChain = new ADAChain();

  // transfer to multisigAddr
  const wallets = wallet.getAddresses();
  const userAddr = wallets[0].id;
  logger.debug(`user address: ${userAddr.toString()}`);
  const amounts = [5000000];
  // transfer from miner to user addr
  const faucetTx: TransactionWallet = await wallet.sendPayment(
    ForceBridgeCore.config.ada.user.passphrase,
    [new AddressWallet(ForceBridgeCore.config.ada.lockAddress)],
    amounts,
  );

  const LockEventReceipent = 'ckt1qyqyph8v9mclls35p6snlaxajeca97tc062sa5gahk';
  const lockAmount = 5000000;
  const lockTxId = await adaChain.sendLockTxs(
    ForceBridgeCore.config.ada.user.public_key,
    lockAmount,
    ForceBridgeCore.config.ada.user.passphrase,
  );
  logger.info(`user ${userAddr.toString()} lock 5000000 ada; the lock tx hash is ${lockTxId}.`);
  const waitTimeout = 1000 * 60 * 5;
  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const adaLockRecords = await conn.manager.find(AdaLock, {
        where: {
          txid: lockTxId,
        },
      });
      const ckbMintRecords = await conn.manager.find(CkbMint, {
        where: {
          id: lockTxId,
        },
      });
      if (adaLockRecords.length == 0 || ckbMintRecords.length === 0) {
        return false;
      }

      logger.info('adaLockRecords', adaLockRecords);
      logger.info('CkbMintRecords', ckbMintRecords);

      assert(adaLockRecords.length === 1);
      const adaLockRecord: any = adaLockRecords[0];
      assert(adaLockRecord.amount === lockAmount.toString());

      assert(ckbMintRecords.length === 1);
      const ckbMintRecord: any = ckbMintRecords[0];
      assert(ckbMintRecord.chain === ChainType.ADA);
      return ckbMintRecord.status === 'success';
    },
    1000 * 10,
  );

  // check sudt balance.
  const account = new Account(PRI_KEY);
  const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
  const asset = new AdaAsset('ada', ownLockHash);
  const bridgeCellLockscript = {
    codeHash: ForceBridgeCore.config.ckb.deps.bridgeLock.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.bridgeLock.script.hashType,
    args: asset.toBridgeLockscriptArgs(),
  };
  const sudtArgs = ckb.utils.scriptToHash(<CKBComponents.Script>bridgeCellLockscript);
  const sudtType = {
    codeHash: ForceBridgeCore.config.ckb.deps.sudtType.script.codeHash,
    hashType: ForceBridgeCore.config.ckb.deps.sudtType.script.hashType,
    args: sudtArgs,
  };
  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const balance = await collector.getSUDTBalance(
        new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
        await account.getLockscript(),
      );

      logger.info('sudt balance:', balance);
      logger.info('expect balance:', new Amount(lockAmount.toString(), 0));
      return balance.eq(new Amount(lockAmount.toString(), 0));
    },
    1000 * 10,
  );

  const burnAmount = new Amount('100000', 0);
  // const account = new Account(PRI_KEY);
  // const ownLockHash = ckb.utils.scriptToHash(<CKBComponents.Script>await account.getLockscript());
  const generator = new CkbTxGenerator(ckb, new IndexerCollector(indexer));
  const burnTx = await generator.burn(
    await account.getLockscript(),
    userAddr.toString(),
    new AdaAsset('ada', ownLockHash),
    burnAmount,
  );
  const signedTx = ckb.signTransaction(PRI_KEY)(burnTx);
  const burnTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.info(`burn Transaction has been sent with tx hash ${burnTxHash}`);
  await waitUntilCommitted(ckb, burnTxHash, 60);

  await waitFnCompleted(
    waitTimeout,
    async (): Promise<boolean> => {
      const balance = await collector.getSUDTBalance(
        new Script(sudtType.codeHash, sudtType.args, sudtType.hashType),
        await account.getLockscript(),
      );

      logger.info('sudt balance:', balance);
      logger.info('expect balance:', new Amount(lockAmount.toString(), 0).sub(burnAmount));
      return balance.eq(new Amount(lockAmount.toString(), 0).sub(burnAmount));
    },
    1000 * 10,
  );

  await waitFnCompleted(
    waitTimeout,
    async () => {
      const adaUnlockRecords = await conn.manager.find(AdaUnlock, {
        where: {
          ckbTxHash: burnTxHash,
          status: 'success',
        },
      });
      if (adaUnlockRecords.length === 0) {
        return false;
      }
      logger.info('adaUnlockRecords', adaUnlockRecords);
      assert(adaUnlockRecords.length === 1);
      const adaUnlockRecord: any = adaUnlockRecords[0];
      assert(adaUnlockRecord.recipientAddress == ForceBridgeCore.config.ada.user.public_key);
      logger.info('amount: ', adaUnlockRecord.amount);
      logger.info('amount: ', burnAmount.toString(0));
      assert(adaUnlockRecord.amount === burnAmount.toString(0));
      return true;
    },
    1000 * 10,
  );

  const lockRecords: AdaLock[] = await adaDb.getLockRecordById(lockTxId);
  logger.info(`successful lock records ${JSON.stringify(lockRecords, null, 2)}`);
  const unlockRecords: AdaUnlock[] = await adaDb.getAdaUnlockRecords('success');
  logger.info(`successful unlock records  ${JSON.stringify(unlockRecords, null, 2)}`);
  assert(lockRecords[0].data.startsWith(LockEventReceipent));
  assert(unlockRecords[0].recipientAddress === userAddr.toString());
  logger.info('end ada test lock and unlock');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
