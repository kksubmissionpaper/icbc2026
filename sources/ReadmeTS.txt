## Overview
Comprehensive benchmarking suite for Sui Move smart contract error handling, gas consumption, and state rollback behavior using TypeScript SDK.

## Purpose
Measures gas costs, latency, and rollback mechanisms across different abort patterns, object types (owned/shared), and execution depths on Sui testnet.

## Test Categories

### Category 1: Depth Variants
Tests abort behavior at 4 depth levels (early/shallow/medium/deep) for owned and shared objects.
- 10 iterations per depth (5 abort, 5 success cases)
- Validates gas consumption scaling with call stack depth

This "Depth Level" refers to "the depth at which an error (Abort) occurs when a function is called", it means it's "the depth of the call stack".
This section is designed to verify the hypothesis "the deeper the location where an error occurs, the higher the cost for Sui to roll back the processing".

- Early (Error at entry point)
An error occurs immediately upon entering the function, typically within the first one or two lines, e.g., failure during argument validation checks, such as assert!(value > 100, ...).
As almost no processing has been performed.

- Shallow (After some processing)
An error occurs after performing simple calculations or calling another function once or twice, i.e. stopping with assert after calculating several variables and calling one helper function. 
A small amount of memory (stack frames) has been used.

- Medium (3–5 layers)
An error occurs within a chain of function calls deeply (e.g., function A calls B, B calls C, etc.), spanning 3–5 layers.
As multiple functions are involved, the Sui Move VM manages the state of all these functions. If it crashes here, all that state must be discarded.

- Deep (6 layers or more)
An error occurs at the deepest level of a very deep function nesting structure (6 layers or more), because it is occurred with many functions stacked. For example, it's a check failing at the final stage of complex business logic.

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

Category 3 examines whether changes are correctly rolled back when errors occur after writing data or creating new objects, and the associated gas costs.

1. Owned Object Creation (Creation followed by Abort)
2. Shared Object Creation (Creation then aborting of Shared Objects)
3. Shared Object Modify (Modification and Cancellation of Shared Objects)
4. Owned Modify (Create + Modify same TX): Utilising Sui's unique feature (Programmable Transaction Block: PTB)

Provide numerical answers (in MIST units) to the following hypotheses and questions:
- Is the cost of "creating but discarding" high?
- Does Storage Cost occur?
- What is the difference in cost between rolling back an Owned object and rolling back a modification to a Shared object?

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

