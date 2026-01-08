/// Inspired by common Move patterns (assert!/abort); see The Move Book: https://move-book.com/

module abort_test::taxonomy {

    // === Imports ===

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;

    // === Errors ===
    // Raised when the provided value is smaller than the required threshold.
    const EVALUETOOSMALL: u64 = 100;

    // Raised when a test intentionally transitions into an invalid state.
    const EINVALIDSTATE: u64 = 102;

    // Error used for the storage-rebate experiment (intentional abort).
    const EREBATE_EXPERIMENT: u64 = 999;

    // === Structs ===
    /// Owned object used for benchmarking abort/failure semantics.
    public struct OwnedTestObject has key, store {
        // Object UID.
        id: UID,
        // Value used by computation-load benchmarks.
        value: u64,
        // Balance used by balance/rebate experiments.
        balance: Balance<SUI>,
        // Payload used by size-sweep experiments.
        payload: vector<u8>,
    }

    /// Shared object used for benchmarking shared-object semantics.
    public struct SharedTestObject has key {
        // Object UID.
        id: UID,
        // Value used by computation-load benchmarks.
        value: u64,
        // Balance used by balance experiments.
        balance: Balance<SUI>,
        // Payload used by size-sweep experiments.
        payload: vector<u8>,
    }

    // === Public Functions ===
    // --- Category 1: Language-Level Errors with Depth (OWNED) ---
    /// Asserts a value threshold and aborts with EVALUETOOSMALL when violated.
    public fun test_owned_early_abort(value: u64) {
        assert!(value >= 100, EVALUETOOSMALL);
    }

    /// Performs light computation then asserts a value threshold.
    public fun test_owned_shallow_abort(value: u64) {
        let _ = light_computation(value);
        assert!(value >= 100, EVALUETOOSMALL);
    }

    /// Performs medium computation then asserts a value threshold.
    public fun test_owned_medium_abort(value: u64) {
        let _ = medium_computation(value);
        assert!(value >= 100, EVALUETOOSMALL);
    }

    /// Performs heavy computation then asserts a value threshold.
    public fun test_owned_deep_abort(value: u64) {
        let _ = heavy_computation(value);
        assert!(value >= 100, EVALUETOOSMALL);
    }

    // --- Category 1: Language-Level Errors with Depth (SHARED) ---
    /// Asserts a value threshold and aborts with EVALUETOOSMALL when violated.
    public fun test_shared_early_abort(value: u64) {
        assert!(value >= 100, EVALUETOOSMALL);
    }

    /// Performs light computation then asserts a value threshold.
    public fun test_shared_shallow_abort(value: u64) {
        let _ = light_computation(value);
        assert!(value >= 100, EVALUETOOSMALL);
    }

    /// Performs medium computation then asserts a value threshold.
    public fun test_shared_medium_abort(value: u64) {
        let _ = medium_computation(value);
        assert!(value >= 100, EVALUETOOSMALL);
    }

    /// Performs heavy computation then asserts a value threshold.
    public fun test_shared_deep_abort(value: u64) {
        let _ = heavy_computation(value);
        assert!(value >= 100, EVALUETOOSMALL);
    }

    // --- Category 2: VM-Level Errors (OWNED/SHARED) ---
    /// Triggers arithmetic overflow when called with values that exceed u64::MAX.
    public fun test_overflow_owned(a: u64, b: u64): u64 { a + b }

    /// Triggers division-by-zero when b == 0.
    public fun test_division_by_zero_owned(a: u64, b: u64): u64 { a / b }

    /// Triggers out-of-bounds when index >= 3.
    public fun test_vector_oob_owned(index: u64): u64 {
        let v = vector[10u64, 20u64, 30u64];
        *vector::borrow(&v, index)
    }

    /// Triggers arithmetic overflow when called with values that exceed u64::MAX.
    public fun test_overflow_shared(a: u64, b: u64): u64 { a + b }

    /// Triggers division-by-zero when b == 0.
    public fun test_division_by_zero_shared(a: u64, b: u64): u64 { a / b }

    /// Triggers out-of-bounds when index >= 3.
    public fun test_vector_oob_shared(index: u64): u64 {
        let v = vector[10u64, 20u64, 30u64];
        *vector::borrow(&v, index)
    }

    // --- Category 3: State Rollback with Objects ---
    /// Creates and transfers an owned object, then optionally aborts.
    #[allow(lint(self_transfer))]
    public fun test_owned_object_creation(should_abort: bool, ctx: &mut TxContext) {
        let obj = OwnedTestObject {
            id: object::new(ctx),
            value: 100,
            balance: balance::zero(),
            payload: vector::empty<u8>(),
        };
        transfer::transfer(obj, tx_context::sender(ctx));
        assert!(!should_abort, EINVALIDSTATE);
    }

    /// Deletes an owned object and recreates a modified one, then optionally aborts.
    #[allow(lint(self_transfer))]
    public fun test_owned_object_modify(
        obj: OwnedTestObject,
        new_value: u64,
        should_abort: bool,
        ctx: &mut TxContext
    ) {
        let OwnedTestObject { id, value: _, balance, payload } = obj;
        object::delete(id);

        let modified = OwnedTestObject {
            id: object::new(ctx),
            value: new_value,
            balance,
            payload,
        };
        transfer::transfer(modified, tx_context::sender(ctx));
        assert!(!should_abort, EINVALIDSTATE);
    }

    /// Creates and shares a shared object, then optionally aborts.
    public fun test_shared_object_creation(should_abort: bool, ctx: &mut TxContext) {
        let obj = SharedTestObject {
            id: object::new(ctx),
            value: 100,
            balance: balance::zero(),
            payload: vector::empty<u8>(),
        };
        transfer::share_object(obj);
        assert!(!should_abort, EINVALIDSTATE);
    }

    /// Modifies a shared object in-place, then optionally aborts.
    public fun test_shared_object_modify(obj: &mut SharedTestObject, new_value: u64, should_abort: bool) {
        obj.value = new_value;
        assert!(!should_abort, EINVALIDSTATE);
    }

    // --- Category 4: Balance Operations ---
    /// Joins a deposited coin into an owned object's balance, then optionally aborts.
    #[allow(lint(self_transfer))]
    public fun test_balance_owned(
        obj: OwnedTestObject,
        deposit: Coin<SUI>,
        should_abort: bool,
        ctx: &mut TxContext
    ) {
        let OwnedTestObject { id, value, mut balance, payload } = obj;
        object::delete(id);

        balance::join(&mut balance, coin::into_balance(deposit));
        assert!(!should_abort, EINVALIDSTATE);

        let modified = OwnedTestObject {
            id: object::new(ctx),
            value,
            balance,
            payload,
        };
        transfer::transfer(modified, tx_context::sender(ctx));
    }

    /// Joins a deposited coin into a shared object's balance, then optionally aborts.
    public fun test_balance_shared(obj: &mut SharedTestObject, deposit: Coin<SUI>, should_abort: bool) {
        balance::join(&mut obj.balance, coin::into_balance(deposit));
        assert!(!should_abort, EINVALIDSTATE);
    }

    // --- Category 5: Storage Rebate Trap (experiment) ---
    //
    // Goal:
    // Compare (success) vs (failure) cases where the transaction aborts before or after
    // the delete/destroy path.
    //
    // TS compatibility:
    // - Keep these two function signatures as-is because main_benchmark.ts calls them:
    //     * test_rebate_success_owned(ctx)
    //     * test_rebate_abort_owned(ctx)
    // - Additional comparison function is provided but TS does not call it by default.

    /// Success case: create -> compute -> destroy (expect success; rebate should apply).
    public fun test_rebate_success_owned(ctx: &mut TxContext) {
        let obj = create_owned_test_object(ctx);
        let _ = heavy_computation(obj.value);
        destroy_owned_object(obj);
    }

    // Failure case (abort-before-destroy): abort before reaching the destroy path.
    //
    /// This function is designed to test whether storage rebate behavior differs when
    /// the transaction fails before object deletion.
    public fun test_rebate_abort_owned(ctx: &mut TxContext) {
        let obj = create_owned_test_object(ctx);
        let _ = heavy_computation(obj.value);

        // Intentionally abort before destroy.
        assert!(false, EREBATE_EXPERIMENT);

        // Unreachable: kept to make the intended contrast explicit.
        destroy_owned_object(obj);
    }

    // Failure case (destroy-then-abort): destroy first, then abort.
    //
    /// This function is useful for a third baseline. It is not invoked by the current TS.
    public fun test_rebate_destroy_then_abort_owned(ctx: &mut TxContext) {
        let obj = create_owned_test_object(ctx);
        let _ = heavy_computation(obj.value);

        destroy_owned_object(obj);
        assert!(false, EREBATE_EXPERIMENT);
    }

    // --- Category 6: Rollback Depth Analysis (OWNED) ---
    /// Shallow rollback: create one object, transfer it, then abort.
    #[allow(lint(self_transfer))]
    public fun test_rollback_shallow_owned(ctx: &mut TxContext) {
        let obj = create_owned_test_object(ctx);
        transfer::transfer(obj, tx_context::sender(ctx));
        assert!(false, EINVALIDSTATE);
    }

    /// Medium rollback: create several objects, transfer them, then abort.
    #[allow(lint(self_transfer))]
    public fun test_rollback_medium_owned(ctx: &mut TxContext) {
        let obj1 = create_owned_test_object(ctx);
        let obj2 = create_owned_test_object(ctx);
        let obj3 = create_owned_test_object(ctx);
        let obj4 = create_owned_test_object(ctx);
        let obj5 = create_owned_test_object(ctx);

        transfer::transfer(obj1, tx_context::sender(ctx));
        transfer::transfer(obj2, tx_context::sender(ctx));
        transfer::transfer(obj3, tx_context::sender(ctx));
        transfer::transfer(obj4, tx_context::sender(ctx));
        transfer::transfer(obj5, tx_context::sender(ctx));

        assert!(false, EINVALIDSTATE);
    }

    /// Deep rollback: create many objects, transfer them, then abort.
    #[allow(lint(self_transfer))]
    public fun test_rollback_deep_owned(ctx: &mut TxContext) {
        let obj1 = create_owned_test_object(ctx);
        let obj2 = create_owned_test_object(ctx);
        let obj3 = create_owned_test_object(ctx);
        let obj4 = create_owned_test_object(ctx);
        let obj5 = create_owned_test_object(ctx);
        let obj6 = create_owned_test_object(ctx);
        let obj7 = create_owned_test_object(ctx);
        let obj8 = create_owned_test_object(ctx);
        let obj9 = create_owned_test_object(ctx);
        let obj10 = create_owned_test_object(ctx);

        transfer::transfer(obj1, tx_context::sender(ctx));
        transfer::transfer(obj2, tx_context::sender(ctx));
        transfer::transfer(obj3, tx_context::sender(ctx));
        transfer::transfer(obj4, tx_context::sender(ctx));
        transfer::transfer(obj5, tx_context::sender(ctx));
        transfer::transfer(obj6, tx_context::sender(ctx));
        transfer::transfer(obj7, tx_context::sender(ctx));
        transfer::transfer(obj8, tx_context::sender(ctx));
        transfer::transfer(obj9, tx_context::sender(ctx));
        transfer::transfer(obj10, tx_context::sender(ctx));

        assert!(false, EINVALIDSTATE);
    }

    // --- Category 7: Payload Sweep ---
    /// Creates an owned object with payload and transfers it to the sender (persist on-chain).
    #[allow(lint(self_transfer))]
    public fun payload_create_owned(len: u64, ctx: &mut TxContext) {
        let obj = create_owned_test_object_with_payload(len, ctx);
        transfer::transfer(obj, tx_context::sender(ctx));
    }

    /// Creates an owned object with payload and destroys it in the same transaction.
    public fun payload_create_destroy_owned(len: u64, ctx: &mut TxContext) {
        let obj = create_owned_test_object_with_payload(len, ctx);
        destroy_owned_object(obj);
    }

    /// Creates a shared object with payload and shares it (persist on-chain).
    public fun payload_create_shared(len: u64, ctx: &mut TxContext) {
        let obj = create_shared_test_object_with_payload(len, ctx);
        transfer::share_object(obj);
    }

    // === Private Functions ===
    /// Creates an owned test object with empty payload and zero balance.
    public fun create_owned_test_object(ctx: &mut TxContext): OwnedTestObject {
        OwnedTestObject {
            id: object::new(ctx),
            value: 0,
            balance: balance::zero(),
            payload: vector::empty<u8>(),
        }
    }

    /// Creates and shares a shared test object with empty payload and zero balance.
    public fun create_shared_test_object(ctx: &mut TxContext) {
        let obj = SharedTestObject {
            id: object::new(ctx),
            value: 0,
            balance: balance::zero(),
            payload: vector::empty<u8>(),
        };
        transfer::share_object(obj);
    }

    /// Destroys an owned test object and deletes its UID.
    public fun destroy_owned_object(obj: OwnedTestObject) {
        let OwnedTestObject { id, value: _, balance, payload: _ } = obj;
        object::delete(id);
        balance::destroy_zero(balance);
    }

    /// Creates an owned test object with a payload of `len` bytes.
    public fun create_owned_test_object_with_payload(len: u64, ctx: &mut TxContext): OwnedTestObject {
        let mut payload = vector::empty<u8>();
        let mut i: u64 = 0;
        while (i < len) {
            vector::push_back(&mut payload, 0u8);
            i = i + 1;
        };

        OwnedTestObject {
            id: object::new(ctx),
            value: 0,
            balance: balance::zero(),
            payload,
        }
    }

    /// Creates a shared test object with a payload of `len` bytes.
    public fun create_shared_test_object_with_payload(len: u64, ctx: &mut TxContext): SharedTestObject {
        let mut payload = vector::empty<u8>();
        let mut i: u64 = 0;
        while (i < len) {
            vector::push_back(&mut payload, 0u8);
            i = i + 1;
        };

        SharedTestObject {
            id: object::new(ctx),
            value: 0,
            balance: balance::zero(),
            payload,
        }
    }

    // Light computation used for depth/compute-load variants.
    fun light_computation(value: u64): u64 {
        let mut result = value;
        let mut i: u64 = 0;
        while (i < 10) {
            result = result + i * 2;
            i = i + 1;
        };
        result
    }

    // Medium computation used for depth/compute-load variants.
    fun medium_computation(value: u64): u64 {
        let mut result = value;
        let mut i: u64 = 0;
        while (i < 50) {
            result = result + i * 2;
            i = i + 1;
        };
        result
    }

    // Heavy computation used for depth/compute-load variants.
    fun heavy_computation(value: u64): u64 {
        let mut result = value;
        let mut i: u64 = 0;
        while (i < 200) {
            result = result + i * 2;
            i = i + 1;
        };
        result
    }
}
