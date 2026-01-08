import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

type ObjectType = 'owned' | 'shared' | 'none';
type AbortDepth = 'early' | 'shallow' | 'medium' | 'deep' | 'na';

interface TestResult {
  category: string;
  objectType: ObjectType;
  abortDepth: AbortDepth;
  pattern: string;
  iteration: number;

  expectedAbort: boolean;
  actualAbort: boolean;
  abortCode?: number;

  gasUsed: number;
  computationCost: number;
  storageCost: number;
  storageRebate: number;
  netGasCost: number;

  wallClockLatency: number;
  executionTime: number;

  errorMessage?: string;
  errorType?: string;

  timestamp: string;
  transactionDigest?: string;
}

class ComprehensiveBenchmark {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private packageId: string;

  private allResults: TestResult[] = [];

  // fixed gas budget (avoid auto-budget dry run)
  //private readonly FIXED_GAS_BUDGET = BigInt(process.env.GAS_BUDGET ?? '30000000');
  private readonly FIXED_GAS_BUDGET = BigInt(process.env.GAS_BUDGET ?? '100000000');

  // shared objects pool to avoid version conflicts from reusing same shared object
  private sharedObjects: string[] = [];

  // throttle
  private readonly SLEEP_BETWEEN_TX_MS = parseInt(process.env.SLEEP_MS ?? '1200', 10);
  private readonly SLEEP_AFTER_SHARED_MS = parseInt(process.env.SLEEP_SHARED_MS ?? '2500', 10);

  constructor() {
    // network is fixed literal to avoid TS union mismatch
    this.client = new SuiClient({ url: getFullnodeUrl('testnet') });

    this.packageId = process.env.PACKAGE_ID!;
    const privateKey = process.env.SUI_PRIVATE_KEY!;

    if (!this.packageId || !privateKey) {
      throw new Error('PACKAGE_ID and SUI_PRIVATE_KEY must be set');
    }

    // robust parsing across SDK variants
    if (privateKey.startsWith('suiprivkey')) {
      // Some SDK versions accept suiprivkey directly; keep permissive cast.
      this.keypair = Ed25519Keypair.fromSecretKey(privateKey as any);
    } else {
      const privateKeyBytes = Uint8Array.from(Buffer.from(privateKey, 'hex'));
      this.keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
    }
  }

  private buildTx(): Transaction {
    const tx = new Transaction();
    tx.setGasBudget(this.FIXED_GAS_BUDGET);
    return tx;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ================
  // Shared pool setup
  // ================

  private async createSharedObject(): Promise<string> {
    const tx = this.buildTx();

    tx.moveCall({
      target: `${this.packageId}::taxonomy::create_shared_test_object`,
      arguments: [],
    });

    const result = await this.client.signAndExecuteTransaction({
      signer: this.keypair,
      transaction: tx,
      options: { showObjectChanges: true, showEffects: true },
    });

    const created = result.objectChanges?.find(
      (c: any) =>
        c.type === 'created' &&
        'objectType' in c &&
        (c.objectType as string).includes('SharedTestObject'),
    ) as any;

    if (!created?.objectId) throw new Error('Failed to create shared object');
    return created.objectId as string;
  }

  private async initSharedPool(count: number): Promise<void> {
    console.log(`\nInitializing shared object pool: ${count} objects`);
    this.sharedObjects = [];

    for (let i = 0; i < count; i++) {
      const id = await this.createSharedObject();
      this.sharedObjects.push(id);
      console.log(` ✓ shared[${i}] = ${id}`);
      await this.sleep(this.SLEEP_AFTER_SHARED_MS);
    }
  }

  private pickShared(i: number): string {
    if (this.sharedObjects.length === 0) throw new Error('Shared pool is empty');
    return this.sharedObjects[i % this.sharedObjects.length];
  }

  // ==================
  // Category 1: Depth
  // ==================

  private async testCategory1_DepthVariants(): Promise<void> {
    console.log('\nCategory 1: Depth Variants (Owned vs Shared)');

    const depths: AbortDepth[] = ['early', 'shallow', 'medium', 'deep'];

    for (const objectType of ['owned', 'shared'] as const) {
      console.log(`\n--- Testing ${objectType.toUpperCase()} ---`);

      for (const depth of depths) {
        console.log(`\nDepth: ${depth}`);

        for (let iteration = 1; iteration <= 10; iteration++) {
          const shouldAbort = iteration <= 5;
          // In Move: assert!(value > 100, E_VALUE_TOO_SMALL=100)
          const value = shouldAbort ? 50n : 150n;

          const tx = this.buildTx();
          const target = `${this.packageId}::taxonomy::test_${objectType}_${depth}_abort`;

          console.log(`[CALL] ${target} value=${value.toString()} shouldAbort=${shouldAbort}`);

          tx.moveCall({
            target,
            arguments: [tx.pure.u64(value)],
          });

          const r = await this.executeAndMeasure(
            'Language-Depth',
            objectType,
            depth,
            `${depth}_abort`,
            iteration,
            shouldAbort,
            tx,
          );

          this.allResults.push(r);
          await this.sleep(this.SLEEP_BETWEEN_TX_MS);
        }
      }
    }
  }

  // =======================
  // Category 2: VM Errors
  // =======================

  private async testCategory2_VMErrors(): Promise<void> {
    console.log('\nCategory 2: VM-Level Errors');

    const U64_MAX = BigInt('18446744073709551615');

    for (const objectType of ['owned', 'shared'] as const) {
      console.log(`\n--- Testing ${objectType.toUpperCase()} ---`);

      // overflow
      console.log('Pattern: overflow');
      for (let iteration = 1; iteration <= 10; iteration++) {
        const shouldAbort = iteration <= 5;
        const tx = this.buildTx();

        const target = `${this.packageId}::taxonomy::test_overflow_${objectType}`;
        tx.moveCall({
          target,
          arguments: [
            tx.pure.u64(shouldAbort ? U64_MAX : 100n),
            tx.pure.u64(shouldAbort ? 1n : 200n),
          ],
        });

        const r = await this.executeAndMeasure('VM-Error', objectType, 'na', 'overflow', iteration, shouldAbort, tx);
        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }

      // division_by_zero
      console.log('Pattern: division_by_zero');
      for (let iteration = 1; iteration <= 10; iteration++) {
        const shouldAbort = iteration <= 5;
        const tx = this.buildTx();

        const target = `${this.packageId}::taxonomy::test_division_by_zero_${objectType}`;
        tx.moveCall({
          target,
          arguments: [tx.pure.u64(100n), tx.pure.u64(shouldAbort ? 0n : 10n)],
        });

        const r = await this.executeAndMeasure('VM-Error', objectType, 'na', 'division_by_zero', iteration, shouldAbort, tx);
        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }

      // vector_oob
      console.log('Pattern: vector_oob');
      for (let iteration = 1; iteration <= 10; iteration++) {
        const shouldAbort = iteration <= 5;
        const tx = this.buildTx();

        const target = `${this.packageId}::taxonomy::test_vector_oob_${objectType}`;
        tx.moveCall({
          target,
          arguments: [tx.pure.u64(shouldAbort ? 10n : 1n)],
        });

        const r = await this.executeAndMeasure('VM-Error', objectType, 'na', 'vector_oob', iteration, shouldAbort, tx);
        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }
    }
  }

  // ==========================
  // Category 3: State rollback
  // ==========================

  private async testCategory3_StateRollback(): Promise<void> {
    console.log('\nCategory 3: State Rollback');

    // Owned creation
    console.log('\n--- Owned Object Creation ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const shouldAbort = iteration <= 5;
      const tx = this.buildTx();

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_owned_object_creation`,
        arguments: [tx.pure.bool(shouldAbort)],
      });

      const r = await this.executeAndMeasure('State-Rollback', 'owned', 'na', 'object_creation', iteration, shouldAbort, tx);
      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }

    // Shared creation
    console.log('\n--- Shared Object Creation ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const shouldAbort = iteration <= 5;
      const tx = this.buildTx();

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_shared_object_creation`,
        arguments: [tx.pure.bool(shouldAbort)],
      });

      const r = await this.executeAndMeasure('State-Rollback', 'shared', 'na', 'object_creation', iteration, shouldAbort, tx);
      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }

    // Shared modification (pool)
    console.log('\n--- Shared Object Modification (pool) ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const shouldAbort = iteration <= 5;
      const sharedId = this.pickShared(iteration - 1);
      const tx = this.buildTx();

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_shared_object_modify`,
        arguments: [tx.object(sharedId), tx.pure.u64(BigInt(iteration * 10)), tx.pure.bool(shouldAbort)],
      });

      const r = await this.executeAndMeasure('State-Rollback', 'shared', 'na', 'object_modify', iteration, shouldAbort, tx);
      this.allResults.push(r);
      await this.sleep(this.SLEEP_AFTER_SHARED_MS);
    }

    // Owned modification (create+modify same tx)
    console.log('\n--- Owned Object Modification (create+modify same TX) ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const shouldAbort = iteration <= 5;
      const tx = this.buildTx();

      const obj = tx.moveCall({
        target: `${this.packageId}::taxonomy::create_owned_test_object`,
        arguments: [],
      });

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_owned_object_modify`,
        arguments: [obj, tx.pure.u64(BigInt(iteration * 10)), tx.pure.bool(shouldAbort)],
      });

      const r = await this.executeAndMeasure('State-Rollback', 'owned', 'na', 'object_modify', iteration, shouldAbort, tx);
      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }
  }

  // ==========================
  // Category 4: Balance Operations
  // ==========================

  private async testCategory4_BalanceOps(): Promise<void> {
    console.log('\nCategory 4: Balance Operations');

    const depositAmount = 1000n; // MIST

    // OWNED
    console.log('\n--- Testing OWNED ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const shouldAbort = iteration <= 5;
      const tx = this.buildTx();

      const obj = tx.moveCall({
        target: `${this.packageId}::taxonomy::create_owned_test_object`,
        arguments: [],
      });

      const [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(depositAmount)]);

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_balance_owned`,
        arguments: [obj, depositCoin, tx.pure.bool(shouldAbort)],
      });

      const r = await this.executeAndMeasure('Balance-Ops', 'owned', 'na', 'balance_owned', iteration, shouldAbort, tx);
      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }

    // SHARED
    console.log('\n--- Testing SHARED ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const shouldAbort = iteration <= 5;
      const sharedId = this.pickShared(iteration - 1);

      const tx = this.buildTx();
      const [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(depositAmount)]);

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_balance_shared`,
        arguments: [tx.object(sharedId), depositCoin, tx.pure.bool(shouldAbort)],
      });

      const r = await this.executeAndMeasure('Balance-Ops', 'shared', 'na', 'balance_shared', iteration, shouldAbort, tx);
      this.allResults.push(r);
      await this.sleep(this.SLEEP_AFTER_SHARED_MS);
    }
  }

  // ==========================
  // Category 5: Rebate trap
  // ==========================

  private async testCategory5_RebateTrap(): Promise<void> {
    console.log('\nCategory 5: Storage Rebate Trap');

    // (1) Success: create -> destroy (effects=success)
    console.log('\n--- Success Case (With Rebate) ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const tx = this.buildTx();

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_rebate_success_owned`,
        arguments: [],
      });

      const r = await this.executeAndMeasure('Rebate-Trap', 'owned', 'na', 'rebate_success', iteration, false, tx);
      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }
    // (2) Failure baseline: abort-before-destroy (effects=failure)
    console.log('\n--- Abort Case (Abort Before Destroy) ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const tx = this.buildTx();

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_rebate_abort_owned`,
        arguments: [],
      });

      const r = await this.executeAndMeasure('Rebate-Trap', 'owned', 'na', 'abort_before_destroy', iteration, true, tx);
      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }

    // (3) destroy-then-abort (effects=failure)
    console.log('\n--- Abort Case (Destroy Then Abort) ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const tx = this.buildTx();

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_rebate_destroy_then_abort_owned`,
        arguments: [],
      });

      const r = await this.executeAndMeasure(
        'Rebate-Trap', 'owned', 'na', 'destroy_then_abort', iteration, true, tx
      );
      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }
  }

  // ==========================
  // Category 6: Rollback depth
  // ==========================

  private async testCategory6_RollbackDepth(): Promise<void> {
    console.log('\nCategory 6: Rollback Depth Analysis');

    const depths: AbortDepth[] = ['shallow', 'medium', 'deep'];

    for (const depth of depths) {
      console.log(`\n--- Depth: ${depth} ---`);

      for (let iteration = 1; iteration <= 20; iteration++) {
        const tx = this.buildTx();

        tx.moveCall({
          target: `${this.packageId}::taxonomy::test_rollback_${depth}_owned`,
          arguments: [],
        });

        const r = await this.executeAndMeasure('Rollback-Depth', 'owned', depth, `rollback_${depth}`, iteration, true, tx);
        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }
    }
  }

  // ==========================
  // Category 7: Payload sweep
  // ==========================

  private async testCategory7_PayloadSweep(): Promise<void> {
    console.log('\nCategory 7: Payload Sweep (Hidden Metadata Tax)');

    // bytes
    const sizes = [0n, 1024n, 4096n, 16384n, 65536n];

    // Owned: create + transfer (persist)
    console.log('\n--- Owned: payload_create_owned (persist) ---');
    for (const sz of sizes) {
      for (let iteration = 1; iteration <= 5; iteration++) {
        const tx = this.buildTx();

        tx.moveCall({
          target: `${this.packageId}::taxonomy::payload_create_owned`,
          arguments: [tx.pure.u64(sz)],
        });

        const r = await this.executeAndMeasure(
          'Payload-Sweep',
          'owned',
          'na',
          `payload_create_owned_${sz}`,
          iteration,
          false,
          tx,
        );

        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }
    }

    // Owned: create + destroy (rebate path)
    console.log('\n--- Owned: payload_create_destroy_owned (rebate) ---');
    for (const sz of sizes) {
      for (let iteration = 1; iteration <= 5; iteration++) {
        const tx = this.buildTx();

        tx.moveCall({
          target: `${this.packageId}::taxonomy::payload_create_destroy_owned`,
          arguments: [tx.pure.u64(sz)],
        });

        const r = await this.executeAndMeasure(
          'Payload-Sweep',
          'owned',
          'na',
          `payload_create_destroy_owned_${sz}`,
          iteration,
          false,
          tx,
        );

        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }
    }

    // Shared: create + share (persist)
    console.log('\n--- Shared: payload_create_shared (persist) ---');
    for (const sz of sizes) {
      for (let iteration = 1; iteration <= 3; iteration++) {
        const tx = this.buildTx();

        tx.moveCall({
          target: `${this.packageId}::taxonomy::payload_create_shared`,
          arguments: [tx.pure.u64(sz)],
        });

        const r = await this.executeAndMeasure(
          'Payload-Sweep',
          'shared',
          'na',
          `payload_create_shared_${sz}`,
          iteration,
          false,
          tx,
        );

        this.allResults.push(r);
        await this.sleep(this.SLEEP_AFTER_SHARED_MS);
      }
    }
  }

  // ==================
  // Execution + Measure
  // ==================

  private async executeAndMeasure(
    category: string,
    objectType: ObjectType,
    abortDepth: AbortDepth,
    pattern: string,
    iteration: number,
    expectedAbort: boolean,
    tx: Transaction,
  ): Promise<TestResult> {
    const start = performance.now();
    const timestamp = new Date().toISOString();

    try {
      const result = await this.client.signAndExecuteTransaction({
        signer: this.keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });

      const end = performance.now();

      const status = result?.effects?.status?.status;
      const statusError = (result as any)?.effects?.status?.error;

      const gasUsed = result.effects?.gasUsed;
      const computation = parseInt(gasUsed?.computationCost ?? '0', 10);
      const storage = parseInt(gasUsed?.storageCost ?? '0', 10);
      const rebate = parseInt(gasUsed?.storageRebate ?? '0', 10);
      const net = computation + storage - rebate;

      // status can be failure without throwing
      if (status === 'failure') {
        const errStr = String(statusError ?? '');

        let abortCode = this.extractAbortCode(errStr);
        let errorType = this.classifyError(errStr);

        // pattern-based certainty for vector_oob (message often lacks bounds detail)
        if (pattern === 'vector_oob') {
          errorType = 'OUT_OF_BOUNDS';
          abortCode = abortCode ?? 9003;
        }

        console.log(
          `[${category}/${pattern}] #${iteration} FAIL`
          + ` | expectedAbort=${expectedAbort}`
          + ` | type=${errorType}`
          + ` | code=${abortCode ?? 'n/a'}`
          + ` | netGas=${net}`
          + ` | latency=${(end - start).toFixed(0)}ms`,
        );

        return {
          category,
          objectType,
          abortDepth,
          pattern,
          iteration,
          expectedAbort,
          actualAbort: true,
          abortCode,
          gasUsed: net,
          computationCost: computation,
          storageCost: storage,
          storageRebate: rebate,
          netGasCost: net,
          wallClockLatency: end - start,
          executionTime: end - start,
          errorMessage: errStr.substring(0, 500),
          errorType,
          timestamp,
          transactionDigest: result.digest,
        };
      }

      console.log(
        `[${category}/${pattern}] #${iteration} SUCCESS`
        + ` | expectedAbort=${expectedAbort}`
        + ` | netGas=${net}`
        + ` | latency=${(end - start).toFixed(0)}ms`,
      );

      return {
        category,
        objectType,
        abortDepth,
        pattern,
        iteration,
        expectedAbort,
        actualAbort: false,
        abortCode: undefined,
        gasUsed: net,
        computationCost: computation,
        storageCost: storage,
        storageRebate: rebate,
        netGasCost: net,
        wallClockLatency: end - start,
        executionTime: end - start,
        timestamp,
        transactionDigest: result.digest,
      };
    } catch (error: any) {
      const end = performance.now();

      const errStrParts: string[] = [];
      if (error?.message) errStrParts.push(String(error.message));
      if (error?.data?.effects?.status?.error) errStrParts.push(String(error.data.effects.status.error));
      if (error?.effects?.status?.error) errStrParts.push(String(error.effects.status.error));
      if (error?.cause?.data?.effects?.status?.error) errStrParts.push(String(error.cause.data.effects.status.error));

      const errorMsg = errStrParts.filter(Boolean).join(' | ') || String(error);

      const effectsGasUsed = error?.data?.effects?.gasUsed ?? error?.effects?.gasUsed ?? error?.cause?.data?.effects?.gasUsed;
      const computation = parseInt(effectsGasUsed?.computationCost ?? '0', 10);
      const storage = parseInt(effectsGasUsed?.storageCost ?? '0', 10);
      const rebate = parseInt(effectsGasUsed?.storageRebate ?? '0', 10);
      const net = computation + storage - rebate;

      let abortCode = this.extractAbortCode(errorMsg);
      let errorType = this.classifyError(errorMsg);

      // pattern-based certainty for vector_oob
      if (pattern === 'vector_oob') {
        errorType = 'OUT_OF_BOUNDS';
        abortCode = abortCode ?? 9003;
      }

      console.log(
        `[${category}/${pattern}] #${iteration} FAIL`
        + ` | expectedAbort=${expectedAbort}`
        + ` | type=${errorType}`
        + ` | code=${abortCode ?? 'n/a'}`
        + ` | netGas=${net}`
        + ` | latency=${(end - start).toFixed(0)}ms`,
      );

      return {
        category,
        objectType,
        abortDepth,
        pattern,
        iteration,
        expectedAbort,
        actualAbort: true,
        abortCode,
        gasUsed: net,
        computationCost: computation,
        storageCost: storage,
        storageRebate: rebate,
        netGasCost: net,
        wallClockLatency: end - start,
        executionTime: end - start,
        errorMessage: errorMsg.substring(0, 500),
        errorType,
        timestamp,
      };
    }
  }

  // ==================
  // Error helpers
  // ==================

  private extractAbortCode(s: string): number | undefined {
    // canonical MoveAbort(... }, 100)
    let m = s.match(/MoveAbort\((?:.|\n)*?\},\s*(\d+)\)/);
    if (m) return parseInt(m[1], 10);

    // looser fallback
    m = s.match(/MoveAbort.*?(\d{1,6})/);
    if (m) return parseInt(m[1], 10);

    // synthetic VM panic codes
    if (/arithmetic|overflow/i.test(s)) return 9001;
    if (/division.*zero/i.test(s)) return 9002;

    // out-of-bounds sometimes appears as text, but vector_oob is handled by pattern override
    if (/out of bounds|index out of range/i.test(s)) return 9003;

    if (/InsufficientGas/i.test(s)) return 9100;

    return undefined;
  }

  private classifyError(s: string): string {
    if (/MoveAbort/i.test(s)) return 'MOVE_ABORT';

    // key classification requested
    if (/MovePrimitiveRuntimeError/i.test(s)) return 'VM_PRIMITIVE_RUNTIME_ERROR';

    if (/not available for consumption|current version/i.test(s)) return 'INPUT_OBJECT_VERSION_CONFLICT';
    if (/arithmetic|overflow/i.test(s)) return 'ARITHMETIC_ERROR';
    if (/division.*zero/i.test(s)) return 'DIVISION_BY_ZERO';
    if (/out of bounds|index out of range/i.test(s)) return 'OUT_OF_BOUNDS';
    if (/InsufficientGas/i.test(s)) return 'INSUFFICIENT_GAS';

    return 'UNKNOWN';
  }

  // ==================
  // Export
  // ==================

  private exportResults(): void {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `comprehensive_benchmark_${ts}.csv`;

    const headers = [
      'category',
      'objectType',
      'abortDepth',
      'pattern',
      'iteration',
      'expectedAbort',
      'actualAbort',
      'abortCode',
      'gasUsed',
      'computationCost',
      'storageCost',
      'storageRebate',
      'netGasCost',
      'wallClockLatency',
      'executionTime',
      'errorMessage',
      'errorType',
      'timestamp',
      'transactionDigest',
    ].join(',');

    const rows = this.allResults
      .map(r => [
        r.category,
        r.objectType,
        r.abortDepth,
        r.pattern,
        r.iteration,
        r.expectedAbort,
        r.actualAbort,
        r.abortCode ?? '',
        r.gasUsed,
        r.computationCost,
        r.storageCost,
        r.storageRebate,
        r.netGasCost,
        r.wallClockLatency.toFixed(2),
        r.executionTime.toFixed(2),
        r.errorMessage ? `"${r.errorMessage.replace(/\"/g, '""')}"` : '',
        r.errorType ?? '',
        r.timestamp,
        r.transactionDigest ?? '',
      ].join(','))
      .join('\n');

    fs.writeFileSync(filename, `${headers}\n${rows}`);
    console.log(`\n✓ Results exported: ${filename}`);
  }

  // ==================
  // Summary + Breakdown
  // ==================

  private printSummary(): void {
    console.log('\n========================================');
    console.log('COMPREHENSIVE BENCHMARK SUMMARY');
    console.log('========================================');

    const total = this.allResults.length;
    const failed = this.allResults.filter(r => r.actualAbort).length;
    const ok = total - failed;

    console.log(`\nTotal Transactions: ${total}`);
    console.log(` ✓ Succeeded: ${ok}`);
    console.log(` ✗ Failed/Aborted: ${failed}`);

    const mismatch = this.allResults.filter(r => r.expectedAbort !== r.actualAbort);
    console.log(`\nExpectation mismatches: ${mismatch.length}`);

    if (mismatch.length > 0) {
      const head = mismatch.slice(0, 8);
      for (const r of head) {
        console.log(
          `  - ${r.category}/${r.pattern}/${r.objectType}/${r.abortDepth}`
          + ` #${r.iteration} expectedAbort=${r.expectedAbort} actualAbort=${r.actualAbort}`
          + (r.errorType ? ` type=${r.errorType}` : '')
          + (r.abortCode != null ? ` code=${r.abortCode}` : ''),
        );
      }
      if (mismatch.length > 8) console.log(`  ... and ${mismatch.length - 8} more`);
    }

    this.printBreakdown();
  }

  private printBreakdown(): void {
    type Key = string;

    const key = (r: TestResult): Key => `${r.category}||${r.pattern}||${r.objectType}||${r.abortDepth}`;

    const groups = new Map<Key, TestResult[]>();
    for (const r of this.allResults) {
      const k = key(r);
      const arr = groups.get(k);
      if (arr) arr.push(r);
      else groups.set(k, [r]);
    }

    const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

    const topFreq = (values: (string | number | undefined)[]): string => {
      const m = new Map<string, number>();
      for (const v of values) {
        if (v === undefined || v === '' || v === null) continue;
        const s = String(v);
        m.set(s, (m.get(s) ?? 0) + 1);
      }
      const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
      return sorted.slice(0, 3).map(([v, c]) => `${v}(${c})`).join(', ') || '-';
    };

    const rows = [...groups.entries()].map(([k, rs]) => {
      const [category, pattern, objectType, abortDepth] = k.split('||');

      const count = rs.length;
      const fail = rs.filter(x => x.actualAbort).length;
      const ok = count - fail;

      const avgGas = avg(rs.map(x => x.netGasCost));
      const avgLat = avg(rs.map(x => x.wallClockLatency));

      const topType = topFreq(rs.map(x => x.errorType));
      const topCode = topFreq(rs.map(x => x.abortCode));

      return {
        category, pattern, objectType, abortDepth,
        count, ok, fail,
        okRate: count ? ok / count : 0,
        avgGas, avgLat,
        topType, topCode,
      };
    });

    rows.sort((a, b) =>
      a.category.localeCompare(b.category)
      || a.pattern.localeCompare(b.pattern)
      || a.objectType.localeCompare(b.objectType)
      || a.abortDepth.localeCompare(b.abortDepth),
    );

    console.log('\n========================================');
    console.log('BREAKDOWN (category/pattern/objectType/depth)');
    console.log('count ok fail okRate avgNetGas avgLatencyMs topErrorType topAbortCode');
    console.log('========================================');

    for (const r of rows) {
      console.log(
        `${r.category}/${r.pattern}/${r.objectType}/${r.abortDepth}`
        + ` | count=${r.count} ok=${r.ok} fail=${r.fail} okRate=${(r.okRate * 100).toFixed(1)}%`
        + ` | avgNetGas=${fmt(r.avgGas)} avgLatencyMs=${fmt(r.avgLat)}`
        + ` | topType=${r.topType} topCode=${r.topCode}`,
      );
    }
  }

  private printOwnedVsSharedComparison(): void {
    type GroupKey = string;
    const key = (r: TestResult): GroupKey => `${r.category}||${r.pattern}||${r.abortDepth}`;

    const groups = new Map<GroupKey, { owned: TestResult[]; shared: TestResult[] }>();

    for (const r of this.allResults) {
      if (r.objectType !== 'owned' && r.objectType !== 'shared') continue;
      const k = key(r);
      const g = groups.get(k) ?? { owned: [], shared: [] };
      g[r.objectType].push(r);
      groups.set(k, g);
    }

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');
    const fmtPct = (n: number) => (Number.isFinite(n) ? (n * 100).toFixed(1) + '%' : 'n/a');

    const rows = [...groups.entries()].map(([k, g]) => {
      const [category, pattern, abortDepth] = k.split('||');

      const ownedN = g.owned.length;
      const sharedN = g.shared.length;

      const ownedOk = g.owned.filter(x => !x.actualAbort).length;
      const sharedOk = g.shared.filter(x => !x.actualAbort).length;

      const ownedOkRate = ownedN ? ownedOk / ownedN : NaN;
      const sharedOkRate = sharedN ? sharedOk / sharedN : NaN;

      const ownedGas = avg(g.owned.map(x => x.netGasCost));
      const sharedGas = avg(g.shared.map(x => x.netGasCost));

      const ownedLat = avg(g.owned.map(x => x.wallClockLatency));
      const sharedLat = avg(g.shared.map(x => x.wallClockLatency));

      return {
        category, pattern, abortDepth,
        ownedN, sharedN,
        ownedOkRate, sharedOkRate,
        ownedGas, sharedGas,
        ownedLat, sharedLat,
        dOkRate: sharedOkRate - ownedOkRate,
        dGas: sharedGas - ownedGas,
        dLat: sharedLat - ownedLat,
      };
    });

    rows.sort((a, b) =>
      a.category.localeCompare(b.category)
      || a.pattern.localeCompare(b.pattern)
      || a.abortDepth.localeCompare(b.abortDepth),
    );

    console.log('\n========================================');
    console.log('OWNED vs SHARED (paired comparison)');
    console.log('category/pattern/depth | okRate(owned,shared,Δ) | avgNetGas(owned,shared,Δ) | avgLatencyMs(owned,shared,Δ)');
    console.log('========================================');

    for (const r of rows) {
      if (!(r.ownedN > 0 && r.sharedN > 0)) continue;
      console.log(
        `${r.category}/${r.pattern}/${r.abortDepth}`
        + ` | okRate=${fmtPct(r.ownedOkRate)}, ${fmtPct(r.sharedOkRate)}, Δ=${fmtPct(r.dOkRate)}`
        + ` | avgNetGas=${fmt(r.ownedGas)}, ${fmt(r.sharedGas)}, Δ=${fmt(r.dGas)}`
        + ` | avgLatencyMs=${fmt(r.ownedLat)}, ${fmt(r.sharedLat)}, Δ=${fmt(r.dLat)}`,
      );
    }
  }

  // ==================
  // Runner
  // ==================

  async runAllTests(): Promise<void> {
    console.log('========================================');
    console.log('COMPREHENSIVE ABORT/ERROR BENCHMARK');
    console.log('========================================');
    console.log(`Package ID: ${this.packageId}`);
    console.log(`Gas Budget (fixed): ${this.FIXED_GAS_BUDGET.toString()}`);
    console.log(`Start Time: ${new Date().toISOString()}`);
    console.log('========================================');

    try {
      // 10 modifications => 10 unique shared objects is ideal; use 12 for buffer
      await this.initSharedPool(12);

      await this.testCategory1_DepthVariants();
      await this.testCategory2_VMErrors();
      await this.testCategory3_StateRollback();
      await this.testCategory4_BalanceOps();
      await this.testCategory5_RebateTrap();
      await this.testCategory6_RollbackDepth();

      // NEW payload sweep (requires redeployed package with payload functions)
      await this.testCategory7_PayloadSweep();

      this.exportResults();
      this.printSummary();
      this.printOwnedVsSharedComparison();
    } catch (e) {
      console.error('\n✗ Benchmark failed:', e);
      if (this.allResults.length > 0) {
        this.exportResults();
        console.log('\n⚠ Partial results exported');
      }
    } finally {
      console.log(`End Time: ${new Date().toISOString()}`);
    }
  }
}

async function main() {
  if (!process.env.PACKAGE_ID || !process.env.SUI_PRIVATE_KEY) {
    console.error('Error: PACKAGE_ID and SUI_PRIVATE_KEY must be set in .env');
    process.exit(1);
  }

  const benchmark = new ComprehensiveBenchmark();
  await benchmark.runAllTests();
}

main().catch(console.error);

export { ComprehensiveBenchmark };
