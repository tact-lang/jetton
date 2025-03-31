# Contributing to Tact Jetton

Thank you for considering contributing to this project! Contributions are welcome and appreciated.

## Scope

We are currently accepting contributions in these directions:

- Fixing existing bugs and compliance with TEPs.
- Improving documentation and tooling.
- Optimizing Tact source code.

If you want to add new functionality that hasn't been implemented before, it's better to open the issue first and discuss it with the maintainers.

## Tests

This repo has different types of tests:

- Tests that were copied from [reference TEP implementation](https://github.com/ton-blockchain/token-contract/blob/568f9c5c291b3cba39bfa75c1770c569c613796e/sandbox_tests/JettonWallet.spec.ts).
- Extended tests for additional functionality and implementation details.
- End-to-end tests for compatibility with API providers.

We strongly advice against changing or editing the first type, since most-likely any new changes and code improvements shouldn't break them (only in case of the bug in the original jetton implementation).

You can run unit tests with `yarn test`.

To run end-to-end tests locally, you need:

1. Deploy Jetton instance in testnet/mainnet. You can use `contract.deploy.ts` script for this.
2. Complete the `.env` file with deployed Jetton data, so verification script could use it to try to index your Jetton in the blockchain.
3. Run `yarn verify-deployment`.

## Benchmarks

To run benchmarks use `yarn bench`. Note that benchmarks fail "early" on the first gas consumption failed assert.

To add new benchmark entry run `yarn bench:add`. This will acquire latest gas usage for all benchmark scenarios and add new entry to the result file.

If you want to update the latest entry instead of adding a new one, run `yarn bench:update`.

To add benchmark for a new type of operation (e.g. new receiver, chain of operations on the Jetton contract, etc.), take a look at the `src/benchmarks/environment.ts`. This file contains logic for getting the gas usage and asserting execution results. After this, you will need to add new `assert` statement to `src/benchmarks/benchmark.ts`.

## How to Contribute

### 0\*. Open an issue

Since the scope of this repository is relatively small, it's better to first discuss the changes, since they might be not planned or already in work.

### 1. Fork the Repository

Start by forking the repository to your GitHub account. This will allow you to make changes without affecting the original repository.

### 2. Clone the Repository

Clone your forked repository to your local machine:

```bash
git clone https://github.com/your-username/jetton.git
cd jetton
```

### 3. Install Dependencies

Install the required dependencies using Yarn:

```bash
yarn install
yarn deduplicate
```

### 4. Make Changes

Make your changes to the codebase. Ensure that your changes align with the project's goals and standards.

### 5. Test Your Changes

Build contracts and run the test suite to ensure your changes do not break existing functionality.

If you are adding new features, consider adding tests for them as well.

### 6\*. Add benchmarks

If you are changing existing Tact code or adding new contracts functionality, it is mandatory to add benchmarks to your pull request.

### 7. Submit a Pull Request

Once your changes are ready, push them to your forked repository and create a pull request to the main repository. Provide a clear description of your changes and why they are necessary. Please link any new PR's with the issues they are closing. Please, allow editing your PR by maintainers, as they won't bother you and in case of any small issues present will edit your PR directly

## Guidelines

- Follow the existing code style and structure.
- Write clear and concise commit messages.
- Ensure your changes are well-documented.
- If your changes include new features, update the relevant documentation files.
- Update benchmarks if you are modifying Tact source code.

## Reporting Issues

If you encounter any issues or have suggestions for improvements, feel free to open an issue in the repository. Provide as much detail as possible to help us understand and address the problem.

## License

By contributing to this project, you agree that your contributions will be licensed under the MIT License.
