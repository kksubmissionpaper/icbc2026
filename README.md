This repository contains the Move smart contracts, the TypeScript benchmarking suite, test result etc.

- Move.toml: The manifest file for the Move package, defining dependencies and named addresses.
- abort_test.move: A Sui Move module designed for testing transaction abort scenarios.

This Sui Move module, abort_test::taxonomy, is a test suite designed to benchmark error handling (Abort), gas calculations, and state rollback behavior in Sui Move.

Primary Structures:

OwnedTestObject
Benchmark object for the ownership model

id: Unique identifier for the object
value: Value for computational load testing
balance: For balance/rebate experiments
payload: Payload for size validation experiments

SharedTestObject
Benchmark object for the shared object model

Basic structure is the same as OwnedTestObject, but accessible simultaneously from multiple transactions

Note: On the client-side TypeScript script, create multiple shared objects for each test scenario upfront. This prevents transaction serialization. (Due to Sui's mechanism, transactions writing to a single shared object are queued sequentially.)

EVALUETOOSMALL    

Error constant for threshold check failure (100)

EREBATE_EXPERIMENT    

Intentional error constant for rebate experiments (999)

Usage:

Deployment: Deploy this package to the Sui blockchain (e.g., testnet/devnet).

Execution: Call each function (e.g., `test_owned_deep_abort`) from TypeScript (client side).

Measurement: Analyze transaction results to examine gas consumption (Computation Cost, Storage Cost, Rebate) and behavior until errors occur.


- comprehensive_benchmark_202...CSV: Result CSV file by the tests.
- main_benchmark.ts: The entry point for the TypeScript-based benchmarking script.
- package.json: Defines Node.js dependencies and scripts for the project.
- tsconfig.json: Configuration file for the TypeScript compiler.
- ReadmeTS.txt: A technical notes specifically for the TypeScript test script.
