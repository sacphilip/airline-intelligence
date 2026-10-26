import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { User } from '../user.entity';

/** A social-provider account linked to a user (US-012). Provider tokens are never stored. */
@Entity('user_identities')
@Unique('uq_user_identities_provider_user', ['provider', 'providerUserId'])
export class UserIdentity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ length: 20 })
  provider: string;

  @Column({ name: 'provider_user_id', length: 100 })
  providerUserId: string;

  @Column({ length: 254 })
  email: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
