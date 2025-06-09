# Jetton (Fungible Token) Implementation in Tact

[![Testnet Deploy](https://img.shields.io/github/actions/workflow/status/tact-lang/jetton/deploy-test.yml?branch=main&style=for-the-badge&logo=stackblitz&label=Testnet%20Deploy)](https://gist.github.com/Kaladin13/3d2f2d0b3e2f5a81f77d8e490e3b2807#file-deploy-result-json)

## Overview

This project includes a complete setup for working with Tact-based Jetton smart contracts. It provides:

- A pre-configured Tact compiler.
- Smart contracts written in the Tact language.
- TypeScript + Jest testing environment with `@ton/sandbox`.
- Gas usage benchmarks throughout different versions

## Implementation versions

Jetton standards are versatile, allowing the utilization of reserved fields and the use of blockchain semantics to implement slightly different versions of the same standard. Because of this, this repository contains several distinct implementations:

- [Base Jetton](./src/contracts/base/), the most fundamental version
- [Governance Jetton](./src/contracts/governance/), with lock and force transfer functionality, used by USDT
- [Feature-rich Jetton](./src/contracts/feature-rich/), version with Jetton send modes, [read more in the docs](./docs/feature-rich.md)
- [Sharded Jetton](./src/contracts/shard/), an implementation that makes use of the latest TVM update, optimizing shard deployment of the Jetton wallet

Moreover, all these versions include features from the [improvements section](#improvements-and-additional-features) and are run on the common test suite that ensures TEP compatibility.

## Goals

This implementation is fully compatible with the following TON standards:

- [TEP-64](https://github.com/ton-blockchain/TEPs/blob/master/text/0064-token-data-standard.md),
- [TEP-74](https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md),
- [TEP-89](https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md).

You can use this implementation as an alternative to the reference Jetton contracts available in the [TON Blockchain repository](https://github.com/ton-blockchain/token-contract).

You can read [Specification](./dev-docs/SPEC.md), that goes into the design choices and differences between this and other implementations

## Improvements and additional features

This implementation also includes new features, that will allow developers and users on TON to easier integrate and work with Jettons in their applications

### Balance on-chain API

This additional receiver provides functionality similar to [TEP-89](https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md), but with wallet balance. You can request and then receive balance from any Jetton wallet with possible additional info for transaction verification

#### Transaction scheme

```mermaid
sequenceDiagram
    participant D as Any Account
    participant C as Jetton Wallet

    D ->>+ C: ProvideWalletBalance<BR />(0x7ac8d559)
    C ->>+ D: TakeWalletBalance<BR />(0xca77fdc2)
```

#### TLB

```tlb
provide_wallet_balance#7ac8d559 receiver:MsgAddress include_verify_info:Bool = InternalMsgBody;

verify_info$_ owner:MsgAddress minter:MsgAddress code:^Cell = VerifyInfo;
take_wallet_balance#ca77fdc2 balance:Coins verify_info:(Maybe VerifyInfo) = InternalMsgBody;
```

### Claim TON from Jetton Wallet/Minter

These receivers both on Jetton Wallet and Jetton Minter allow to claim stale TON coins from contracts, leaving just enough balance for them to not freeze and function properly. Message body includes `receiver` field, that allows to specify funds receiver

#### Transaction scheme

```mermaid
sequenceDiagram
    participant D as Owner
    participant C as Jetton Wallet/Minter
    participant F as msg.receiver

    D ->>+ C: ClaimTON<BR />(0x0393b1ce)
    C ->>+ F: TON's<BR />(empty body)
```

#### TLB

```tlb
claim_ton#0393b1ce receiver:MsgAddress = InternalMsgBody;
```

## Getting Started

### 1. Install Dependencies

Run the following command to install all required dependencies:

```bash
yarn install
```

### 2. Build Contracts

Compile the smart contracts with:

```bash
yarn build
```

### 3. Deploy Contracts

Customize your Jetton by editing the `contract.deploy.ts` file. This file also includes a detailed deployment guide. Deploy the contracts with:

```bash
yarn deploy
```

#### 4. Deployment Verification

To verify that your Jetton contract was deployed correctly, you can use the built-in verification test:

Run the verification test:

```bash
yarn verify-deployment
```

This verification test will check:

- If the contract is active
- If the contract parameters match what you specified
- If the contract metadata is correctly set up

### 5. Read Contract Data

You can read on-chain data for the minter from its address using script `src/scripts/contract.read.ts`

```bash
yarn read
```

Example output:

```shell
❯ yarn read
yarn run v1.22.22
$ ts-node ./src/scripts/contract.read.ts
Enter minter address: kQC58H9FUaJ0XUBKq9lXJxF_JBQZIy0dC4_7y4ggr9PEKClM

Minter data
Total supply: 1000000000000000000
Owner: EQD2ZeBj70MzYZll7HVTT4cNSn62-P0VCL4ncCd-08-4alAY
Is mintable: Yes
Token name: TactJetton
Description: This is description of Jetton #41 (Run at 14171609974 - 1)
Image: https://raw.githubusercontent.com/tact-lang/tact/refs/heads/main/docs/public/logomark-light.svg
Done in 5.03s.
```

### 6. Test Contracts

Run tests in the `@ton/sandbox` environment:

```bash
yarn test
```

### 6. Benchmark Contracts

To run gas usage benchmarks and get them printed in the table, use

```bash
yarn bench
```

Example output

```shell
❯ yarn bench
yarn run v1.22.22
$ cross-env PRINT_TABLE=true ts-node ./src/benchmarks/benchmarks.ts
Gas Usage Results:
┌────────────────────────────────────────────────────────────────────┬────────────────┬────────────────┬────────────────┬───────────────┬───────────────┬─────────────┬────────────────┬──────┐
│ Run                                                                │ transfer       │ mint           │ burn           │ discovery     │ reportBalance │ claimWallet │ Summary        │ PR # │
├────────────────────────────────────────────────────────────────────┼────────────────┼────────────────┼────────────────┼───────────────┼───────────────┼─────────────┼────────────────┼──────┤
│ Initial                                                            │ 16319          │ 18811          │ 12558          │ 6655          │ -             │ -           │ 54343          │ 77   │
├────────────────────────────────────────────────────────────────────┼────────────────┼────────────────┼────────────────┼───────────────┼───────────────┼─────────────┼────────────────┼──────┤
│ With Tact-lang changes (selector hack and basechain optimizations) │ 15511 (-4.95%) │ 18027 (-4.17%) │ 12390 (-1.34%) │ 6557 (-1.47%) │ -             │ -           │ 52485 (-3.42%) │ 83   │
├────────────────────────────────────────────────────────────────────┼────────────────┼────────────────┼────────────────┼───────────────┼───────────────┼─────────────┼────────────────┼──────┤
│ With Report Balance                                                │ 15511 same     │ 18027 same     │ 12408 (+0.15%) │ 6557 same     │ 4537 (new)    │ -           │ 57040 (+8.68%) │ 84   │
├────────────────────────────────────────────────────────────────────┼────────────────┼────────────────┼────────────────┼───────────────┼───────────────┼─────────────┼────────────────┼──────┤
│ Set selector-hack flag to default value                            │ 15651 (+0.90%) │ 18195 (+0.93%) │ 12576 (+1.35%) │ 6655 (+1.49%) │ 4607 (+1.54%) │ -           │ 57684 (+1.13%) │ 86   │
├────────────────────────────────────────────────────────────────────┼────────────────┼────────────────┼────────────────┼───────────────┼───────────────┼─────────────┼────────────────┼──────┤
│ With Ton Claim                                                     │ 15651 same     │ 17799 (-2.18%) │ 12944 (+2.93%) │ 6612 (-0.65%) │ 4440 (-3.62%) │ 4030 (new)  │ 61476 (+6.57%) │ 90   │
└────────────────────────────────────────────────────────────────────┴────────────────┴────────────────┴────────────────┴───────────────┴───────────────┴─────────────┴────────────────┴──────┘

Comparison with Tact Jetton implementation:
Transfer: 95.91% of Tact Jetton gas usage
Mint: 94.62% of Tact Jetton gas usage
Burn: 103.07% of Tact Jetton gas usage
Discovery: 99.35% of Tact Jetton gas usage
ReportBalance: new! of Tact Jetton gas usage
ClaimWallet: new! of Tact Jetton gas usage
Done in 2.17s.
```

If you want to modify the contracts and benchmark your implementation, you can run

```bash
# add to add new entry
yarn bench:add
# or update to replace latest
yarn bench:update
```

After that, use `yarn bench` to pretty-print the difference table with your results in it

## Jetton Architecture

If you're new to Jettons, read the [TON Jettons Processing](https://docs.ton.org/develop/dapps/asset-processing/jettons).

## Project Structure

Smart contracts, their tests, and the deployment script are located in the `src` directory:

```
src/
│
│   # Contracts and auxiliary Tact code
├── contracts/
│   ├── jetton-minter.tact
│   ├── jetton-wallet.tact
│   ├── messages.tact
│   └── constants.tact
│
│   # Tests
├── tests/
│   ├── extended.spec.ts
│   └── jetton.spec.ts
│
│   # Deployment script
├── scripts/
│   ├── contract.deploy.ts
│   └── contract.read.ts
│
│   # Miscellaneous utility things
└── utils/
```

Note that tests and the deployment script require the compiled contracts to be present in the `src/output` directory.

The configuration for the Tact compiler is in `tact.config.json` in the root of the repository. In most cases, you won't need to change this file.

## Smart Contracts Structure

The main smart contract is `jetton-minter.tact`, it imports `messages.tact`, `constants.tact` and `jetton-wallet.tact`. With the default configuration of `tact.config.json` targeting `jetton-minter.tact`, they're all compiled automatically.

Scheme of imports:

```mermaid
graph LR
    B[jetton-minter.tact] -->|import| A[messages.tact]
    C[jetton-wallet.tact] -->|import| A[messages.tact]
    B[jetton-minter.tact] -->|import| C[jetton-wallet.tact]

    C[jetton-wallet.tact] -->|import| E[constants.tact]
    B[jetton-minter.tact] -->|import| E[constants.tact]
```

Read more about imports in the [Tact standard library](https://docs.tact-lang.org/ref/standard-libraries/).

## Contributing

Please check [CONTRIBUTING.md](dev-docs/CONTRIBUTING.md)

## Best Practices

- For guidance on interacting with Jettons using Tact, read the [Jetton cookbook](https://docs.tact-lang.org/cookbook/jettons/).
- Be cautious of fake messages sent by scammers. Read [security best practices](https://docs.tact-lang.org/book/security-best-practices/) to protect yourself from fraudulent activities.
- Always consult the [official Tact documentation](https://docs.tact-lang.org/) for additional resources and support.
- Check [Specification](dev-docs/SPEC.md) for more in-depth dive into implementation details

## License

This project is licensed under the MIT License.
