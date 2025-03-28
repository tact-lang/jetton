# Tact-Native Jetton Implementation

This documents disscusses design choises and differences between this and other jetton implementations

## Gas assertions

There are a few ways to deal with TEP-74 defined gas constraints and storage fees:

- Precalculated in emulation gas constants
- Hardcoded raw nanotons amount
- Runtime calculations using latest blockchain configuaraton
- Original forward fee approximations

We decided to use a mixed approach:

#### Hardcoded ton amount with `nativeReserve` and SendMode `SendRemainingBalance` for storage phase assertions

We moved away from using `myStorageDue()` or `getStorageFee()` to work with storage fees since big enought constant to not allow contract freezing together with the ability to claim TON from both Minter and Wallet contracts are good solution that will work in all production use-cases

```tact
const minTonsForStorage: Int = ton("0.01");

nativeReserve(minTonsForStorage, ReserveExact | ReserveBounceIfActionFail);

message(MessageParameters {
    to: msg.receiver,
    value: 0,
    mode: SendRemainingBalance,
});
```

#### Precalculated gas constants and forward fee approximations for compute/action phase assertions

This is combination of two techniques:

- Using gas constants with `getComputeFee()` to always get precise compute fees in nanotons
- Using `ctx.readForwardFee()` for approximation when the outgoing message size is always smaller or the same compared to the incoming

```tact
const gasForTransfer: Int = 8000;

let ctx = context();
let fwdCount = 1 + sign(msg.forwardTonAmount);

require(
    ctx.value >
    msg.forwardTonAmount +
    fwdCount * ctx.readForwardFee() +
    (2 * getComputeFee(gasForTransfer, false) + minTonsForStorage),
    "Insufficient amount of TON attached",
);
```


