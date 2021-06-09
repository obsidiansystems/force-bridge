import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { dbTxStatus } from './CkbMint';

export type AdaUnlockStatus = dbTxStatus;

@Entity()
export class AdaUnlock {
  @PrimaryColumn()
  ckbTxHash: string;

  @Column()
  chain: number;

  @Column()
  asset: string;

  @Column()
  amount: string;

  @Column()
  recipientAddress: string;

  @Column({ nullable: true })
  btcTxHash: string;

  @Column({ default: 'todo' })
  status: AdaUnlockStatus;

  @Column({ type: 'text', nullable: true })
  message: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
