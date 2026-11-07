import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { LiveService } from '../live/live.service';

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany']);

/** The database. Migrations are applied before the app starts (`prisma migrate deploy`). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    /** Without `live` (tests), writes aren't reported. */
    constructor(@Optional() live?: LiveService) {
        super();
        if (!live) return;
        // Every write tells LiveService which table changed, wherever it came from, so open
        // pages refresh. The extended client stands in for this one everywhere it's injected.
        return this.$extends({
            query: {
                $allModels: {
                    async $allOperations({ model, operation, args, query }) {
                        const result = await query(args);
                        if (WRITES.has(operation)) live.changed(model);
                        return result;
                    },
                },
            },
        }) as unknown as PrismaService;
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}

/** The client inside `prisma.$transaction(async (tx) => ...)`. */
export type Tx = Prisma.TransactionClient;
/** Either the client or a transaction, for helpers used both ways. */
export type Db = PrismaService | Tx;
