## Overview
Comprehensive benchmarking suite for Sui Move smart contract error handling, gas consumption, and state rollback behavior using TypeScript SDK.

## Purpose
Measures gas costs, latency, and rollback mechanisms across different abort patterns, object types (owned/shared), and execution depths on Sui testnet.

## Test Categories

### Category 1: Depth Variants
Tests abort behavior at 4 depth levels (early/shallow/medium/deep) for owned and shared objects.
- 10 iterations per depth (5 abort, 5 success cases)
- Validates gas consumption scaling with call stack depth

### Category 2: VM Errors
Tests runtime VM errors:
- Arithmetic overflow (u64 max value)
- Division by zero
- Vector out-of-bounds access

### Category 3: State Rollback
Tests object lifecycle rollback:
- Object creation + abort
- Object modification + abort
- Shared object pool management (version conflict avoidance)

### Category 4: Balance Operations
Tests SUI coin deposit/abort scenarios:
- Splits 1000 MIST from gas coin
- Validates balance rollback on abort

### Category 5: Rebate Trap
Critical storage rebate analysis:
- Success: create → destroy (rebate obtained)
- Abort before destroy (no rebate)
- Destroy then abort (rebate behavior)

### Category 6: Rollback Depth Analysis
Measures rollback cost differences across 3 depth levels (20 iterations each).

### Category 7: Payload Sweep
Tests storage cost with varying payload sizes (0, 1KB, 4KB, 16KB, 64KB):
- Owned: create+transfer (persist)
- Owned: create+destroy (rebate path)
- Shared: create+share (persist)

## Setup

### Prerequisites
- Node.js
- Sui TypeScript SDK (@mysten/sui)
- Deployed Move contract on Sui testnet

### Environment Variables (.env)
PACKAGE_ID	The unique identifier of the deployed Sui Move package on the Sui testnet network.	
UPGRADE_CAP	The capability object ID required to authorize package upgrades.	
SUI_ADDRESS	The test wallet address used for signing transactions and paying gas fees.	
SUI_PRIVATE_KEY	The secret key for the test wallet. Keep this secure and never share it.	

## Execution
npx ts-node main_benchmark.ts

## Output
- CSV file: comprehensive_benchmark_YYYY-MM-DDTHH-MM-SS.csv
- Console: Summary statistics, category breakdown, owned vs shared comparison

## Notes
- All tests run on Sui testnet
- Set a fixed gas budget (default 100,000,000 MIST) on the testnet
- Shared object tests use pre-created object pool (12 objects)
- Each test records expected vs actual abort status for validation

