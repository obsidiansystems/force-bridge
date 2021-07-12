import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
export type AdaLockStatus = 'pending' | 'submitted' | 'in_ledger' | 'in_ledger';
@Entity()
export class AdaLock {
  @PrimaryColumn()
  txid: string;

  @Index()
  @Column()
  sender: string;

  @Column()
  amount: number;

  @Column()
  status: string;

  @Column()
  data: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
