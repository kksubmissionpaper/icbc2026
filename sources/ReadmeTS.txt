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

This category tests for unexpected Runtime Errors that occur during program execution. It verifies how Sui Move VM handles these incidents and what error codes and gas consumption values return.
Tests are conducted for both Owned and Shared object types.

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

This category tests whether SUI coin transfers are correctly canceled (reverted) when errors occur. We performed this test on both Owned objects and Shared objects.

- First, we carved out 1000 MIST worth from our Gas Coin to create a new small coin object.
- Deposit (merge) that 1000 MIST coin into a test object (either Owned or Shared).
- Immediately after the deposit completes, intentionally trigger an Abort.

The result measures whether the 1000 MIST that was reliably carved out reliably returns to the original Gas Coin, and whether there is a difference in the processing cost.


### Category 5: Rebate Trap
Critical storage rebate analysis:
This category verifies the behavior of Sui's storage rebate mechanism under success/different failure scenarios.

Test Scenarios:
1.  Success Case (Normal): Creates and then destroys an object within the same transaction.
2.  Abort Before Destroy: Attempts to destroy an object but aborts "before" the destruction instruction is executed.
3.  Destroy Then Abort: Destroys an object but then aborts "later" in the same transaction.


### Category 6: Rollback Depth Analysis
Measures rollback cost differences across 3 depth levels (20 iterations each).

This category is similar to Category 1, but differs in that it focuses specifically on measuring the "cost of the rollback itself". In other words, it assumes all transaction is aborted.
It involves repeatedly executing a transaction which is always failing at varying depths (Shallow / Medium / Deep), measuring "how exactly does the gas cost for the rollback change when the depth increases by one level?".
To simplify the experiment, we avoided using Shared Objects, which are prone to external factors (such as consensus or lock contention), and then used only Owned Objects.

### Category 7: Payload Sweep
Tests storage cost with varying payload sizes (0, 1KB, 4KB, 16KB, 64KB):
- Owned: create+transfer (persist)
- Owned: create+destroy (rebate path)
- Shared: create+share (persist)

This category tests how increasing an object's data size (capacity) affects cost and behavior. Specifically, by incrementally increasing the size (sweeping), we tested whether the cost increases cleanly in proportion to the size, or whether it suddenly becomes significantly heavier once a certain size is exceeded.


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

