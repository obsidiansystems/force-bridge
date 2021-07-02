import { WalletServer } from 'cardano-wallet-js';
import { ChainType } from '../ckb/model/asset';
import { forceBridgeRole } from '../config';
import { ForceBridgeCore } from '../core';
import { AdaDb } from '../db/ada';
import { AdaUnlock, AdaUnlockStatus } from '../db/entity/AdaUnlock';
import { asyncSleep } from '../utils';
import { logger } from '../utils/logger';
import { ADAChain, AdaLockData, AdaUnlockResult } from '../xchain/ada';

const CkbAddressLen = 46;
export class AdaHandler {
  constructor(private db: AdaDb, private adaChain: ADAChain, private role: forceBridgeRole) {}

  // listen ADA chain and handle the new lock events
  async watchLockEvents() {
    logger.debug('start ADA watchLockEvents');
    while (true) {
      try {
        await asyncSleep(1000 * 60);
        //checking if we have enough confimation from the last record
        await this.adaChain.watchAdaTxEvents(
          //need to be triggered when lock event is happened,
          //adding lock event status in database
          async (adaLockEventData: AdaLockData) => {
            logger.info(`AdaHandler watchAdaTxEvents newEvents:${JSON.stringify(adaLockEventData, null, 2)}`);

            if (this.role === 'collector') {
              await this.db.createCkbMint([
                {
                  id: adaLockEventData.txId,
                  chain: ChainType.ADA,
                  amount: adaLockEventData.amount,
                  asset: 'ada',
                  recipientLockscript: adaLockEventData.data.slice(0, CkbAddressLen),
                },
              ]);
              logger.info(`AdaHandler watchAdaTxEvents save CkbMint successful for ADA tx ${adaLockEventData.txId}.`);
            }

            await this.db.createAdaLock([
              {
                txid: adaLockEventData.txId,
                sender: adaLockEventData.sender,
                amount: adaLockEventData.amount,
                data: adaLockEventData.data,
              },
            ]);
            logger.info(`AdaHandler watchAdaTxEvents save ADALock successful for ADA tx ${adaLockEventData.txId}.`);
          },
          //triggers when unlock event is spotted
          //need to update the unlock transaction status
          async (ckbTxHash: string) => {
            if (!ckbTxHash.startsWith('0x')) {
              ckbTxHash = '0x' + ckbTxHash;
            }
            const records: AdaUnlock[] = await this.db.getNotSuccessUnlockRecord(ckbTxHash);
            if (records.length === 0) {
              return;
            }
            logger.debug(`AdaHandler watchAdaTxEvents unlockRecords: ${JSON.stringify(records, null, 2)}`);
            if (records.length > 1) {
              throw new Error(
                `there are some unlock record which have the same ckb burn hash.  ${JSON.stringify(records, null, 2)}`,
              );
            }
            records[0].status = 'success';
            await this.db.saveAdaUnlock(records);
          },
        );
      } catch (e) {
        logger.error('there is an error occurred during in ada chain watch event', e.toString());
      }
    }
  }

  // watch the ADA_unlock table and handle the new unlock events
  // send tx according to the data
  async watchUnlockEvents() {
    if (this.role !== 'collector') {
      return;
    }
    // todo: get and handle pending and error records
    logger.info('AdaHandler watchUnlockEvents start');
    while (true) {
      await asyncSleep(1000 * 20);
      const records: AdaUnlock[] = await this.db.getAdaUnlockRecords('todo');
      if (records.length === 0) {
        continue;
      }
      logger.debug(
        `AdaHandler watchUnlockEvents get ada unlock record and send tx ${JSON.stringify(records, null, 2)}`,
      );
      try {
        // write db first, avoid send tx success and fail to write db
        records.map((r) => {
          r.status = 'pending';
        });
        await this.db.saveAdaUnlock(records);
        const txRes = await this.adaChain.sendUnlockTxs(records);
        records.map((r) => {
          r.status = 'pending';
          r.adaTxId = txRes.txId;
        });
        await this.db.saveAdaUnlock(records);
      } catch (e) {
        records.map((r) => {
          r.status = 'error';
          r.message = e.message;
        });
        await this.db.saveAdaUnlock(records);
        logger.error(
          `AdaHandler watchUnlockEvents there is an error occurred during in ada chain send unlock.`,
          e.toString(),
        );
      }
    }
  }

  start() {
    this.watchLockEvents();
    this.watchUnlockEvents();
    logger.info('ADA handler started  🚀');
  }
}
