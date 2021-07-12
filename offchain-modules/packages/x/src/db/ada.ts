// invoke in ADA handler
import { Connection, Not, Repository } from 'typeorm';
import { ForceBridgeCore } from '../core';
import { AdaLockStatus } from './entity/AdaLock';
import { AdaUnlockStatus } from './entity/AdaUnlock';
import {
  AdaLock,
  AdaUnlock,
  CkbBurn,
  CkbMint,
  IAdaLock,
  IAdaUnLock,
  ICkbMint,
  IQuery,
  LockRecord,
  UnlockRecord,
} from './model';

export class AdaDb implements IQuery {
  private ckbMintRepository: Repository<CkbMint>;
  private adaLockRepository: Repository<AdaLock>;
  private adaUnlockRepository: Repository<AdaUnlock>;

  constructor(private connection: Connection) {
    this.ckbMintRepository = connection.getRepository(CkbMint);
    this.adaLockRepository = connection.getRepository(AdaLock);
    this.adaUnlockRepository = connection.getRepository(AdaUnlock);
  }

  async createCkbMint(records: ICkbMint[]): Promise<void> {
    const dbRecords = records.map((r) => this.ckbMintRepository.create(r));
    await this.ckbMintRepository.save(dbRecords);
  }

  async createAdaUnlock(records: IAdaUnLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.adaUnlockRepository.create(r));
    await this.adaUnlockRepository.save(dbRecords);
  }

  async saveAdaUnlock(records: AdaUnlock[]): Promise<void> {
    await this.adaUnlockRepository.save(records);
  }

  async createAdaLock(records: IAdaLock[]): Promise<void> {
    const dbRecords = records.map((r) => this.adaLockRepository.create(r));
    await this.adaLockRepository.save(dbRecords);
  }

  async getNotSuccessUnlockRecord(ckbTxHash: string): Promise<AdaUnlock[]> {
    const successStatus: AdaUnlockStatus = 'success';
    return await this.adaUnlockRepository.find({
      status: Not(successStatus),
      ckbTxHash: ckbTxHash,
    });
  }

  async getLockRecordById(adaLockId: string): Promise<AdaLock[]> {
    return await this.adaLockRepository.find({
      txid: adaLockId,
    });
  }

  async getAdaUnlockRecords(status: AdaUnlockStatus, take = 2): Promise<AdaUnlock[]> {
    return this.adaUnlockRepository.find({
      where: {
        status,
      },
      take,
    });
  }

  async getAdaLockRecords(status: AdaLockStatus, take = 1): Promise<AdaLock[]> {
    return this.adaLockRepository.find({
      where: {
        status,
      },
      take,
    });
  }

  async updateAdaLockRecords(adaLockId: string, status: string): Promise<AdaLock> {
    return this.adaLockRepository.save({
      txid: adaLockId,
      status,
    });
  }

  async getLockRecordsByCkbAddress(ckbRecipientAddr: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.connection
      .getRepository(CkbMint)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('ada_lock', 'ada', 'ada.txid = ckb.id')
      .where('ckb.recipient_lockscript = :recipient  AND ckb.asset = :asset', {
        recipient: ckbRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        ada.sender as sender,
        ada.amount as lock_amount,
        ckb.amount as mint_amount,
        ada.txid as lock_hash,
        ckb.mint_hash as mint_hash,
        ada.updated_at as lock_time, 
        ckb.updated_at as mint_time, 
        ckb.status as status,
        ckb.asset as asset,
        ckb.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getUnlockRecordsByCkbAddress(ckbLockScriptHash: string, XChainAsset: string): Promise<UnlockRecord[]> {
    return await this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('ada_unlock', 'ada', 'ada.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.sender_lock_hash = :sender_lock_hash AND ckb.asset = :asset', {
        sender_lock_hash: ckbLockScriptHash,
        asset: XChainAsset,
      })

      .select(
        `
        ckb.sender_lock_hash as sender, 
        ada.recipient_address as recipient , 
        ckb.amount as burn_amount, 
        ada.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        ada.ada_tx_hash as unlock_hash,
        ada.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        ada.status as status,
        ckb.asset as asset,
        ada.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getLockRecordsByXChainAddress(XChainSender: string, XChainAsset: string): Promise<LockRecord[]> {
    return await this.connection
      .getRepository(CkbMint)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('ada_lock', 'ada', 'ada.txid = ckb.id')
      .where('ada.sender = :sender AND ckb.asset = :asset', { sender: XChainSender, asset: XChainAsset })
      .select(
        `
        ada.sender as sender,
        ckb.recipient_lockscript as recipient,
        ada.amount as lock_amount,
        ckb.amount as mint_amount,
        ada.txid as lock_hash,
        ckb.mint_hash as mint_hash,
        ada.updated_at as lock_time, 
        ckb.updated_at as mint_time, 
        ckb.status as status,
        ckb.asset as asset,
        ckb.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }

  async getUnlockRecordsByXChainAddress(XChainRecipientAddr: string, XChainAsset: string): Promise<UnlockRecord[]> {
    return await this.connection
      .getRepository(CkbBurn)
      .createQueryBuilder('ckb')
      .innerJoinAndSelect('ada_unlock', 'ada', 'ada.ckb_tx_hash = ckb.ckb_tx_hash')
      .where('ckb.recipient_address = :recipient_address AND ckb.asset = :asset', {
        recipient_address: XChainRecipientAddr,
        asset: XChainAsset,
      })
      .select(
        `
        ckb.sender_lock_hash as sender, 
        ada.recipient_address as recipient , 
        ckb.amount as burn_amount, 
        ada.amount as unlock_amount,
        ckb.ckb_tx_hash as burn_hash,
        ada.ada_tx_hash as unlock_hash,
        ada.updated_at as unlock_time, 
        ckb.updated_at as burn_time, 
        ada.status as status,
        ckb.asset as asset,
        ada.message as message
      `,
      )
      .orderBy('ckb.updated_at', 'DESC')
      .getRawMany();
  }
}
