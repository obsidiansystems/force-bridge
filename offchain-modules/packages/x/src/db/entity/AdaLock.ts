import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class AdaLock {
  @PrimaryColumn()
  txid: string;

  @Index()
  @Column()
  sender: string;

  @Column()
  amount: string;

  @Column()
  status: string;

  @Column()
  data: string;

  @CreateDateColumn()
  createdAt: string;

  @UpdateDateColumn()
  updatedAt: string;
}
