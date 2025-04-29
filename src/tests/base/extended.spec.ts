import {Address, beginCell, Cell, SendMode, toNano} from "@ton/core"
import {Blockchain, BlockchainSnapshot, SandboxContract, TreasuryContract} from "@ton/sandbox"
import {ExtendedJettonWallet} from "../../wrappers/ExtendedJettonWallet"
import {ExtendedJettonMinter} from "../../wrappers/ExtendedJettonMinter"
import {ExtendedFeatureRichJettonWallet} from "../../wrappers/ExtendedFeatureRichJettonWallet"
import {ExtendedFeatureRichJettonMinter} from "../../wrappers/ExtendedFeatureRichJettonMinter"
import {findTransactionRequired, randomAddress} from "@ton/test-utils"
import {
    computeGasFee,
    getGasPrices,
    getMsgPrices,
    getOriginalFwdFee,
} from "../governance-tests/gasUtils"
import {
    CloseMinting,
    gasForBurn,
    gasForTransfer,
    JettonMinter,
    JettonUpdateContent,
    Mint,
    minTonsForStorage,
    storeJettonBurn,
    storeJettonTransfer,
    storeMint,
    storeTakeWalletBalance,
    TakeWalletBalance,
} from "../../output/Jetton_JettonMinter"
import {getComputeGasForTx} from "../../utils/gas"

// Use describe.each to parameterize the test suite for both base and feature-rich jetton versions
describe.each([
    {
        name: "Base Jetton",
        MinterWrapper: ExtendedJettonMinter,
        WalletWrapper: ExtendedJettonWallet,
    },
    {
        name: "Feature Rich Jetton",
        MinterWrapper: ExtendedFeatureRichJettonMinter,
        WalletWrapper: ExtendedFeatureRichJettonWallet,
    },
])("$name", ({MinterWrapper, WalletWrapper}) => {
    let blockchain: Blockchain
    let jettonMinter: SandboxContract<InstanceType<typeof MinterWrapper>>
    let jettonWallet: SandboxContract<InstanceType<typeof WalletWrapper>>
    let deployer: SandboxContract<TreasuryContract>

    let _jwallet_code = new Cell()
    let _minter_code = new Cell()
    let notDeployer: SandboxContract<TreasuryContract>

    let userWallet: (
        address: Address,
    ) => Promise<SandboxContract<InstanceType<typeof WalletWrapper>>>
    let defaultContent: Cell
    let snapshot: BlockchainSnapshot

    beforeAll(async () => {
        blockchain = await Blockchain.create()
        deployer = await blockchain.treasury("deployer")
        notDeployer = await blockchain.treasury("notDeployer")

        defaultContent = beginCell().endCell()
        const msg: JettonUpdateContent = {
            $$type: "JettonUpdateContent",
            queryId: 0n,
            content: defaultContent,
        }

        jettonMinter = blockchain.openContract(
            await MinterWrapper.fromInit(0n, deployer.address, defaultContent),
        )

        const deployResult = await jettonMinter.send(
            deployer.getSender(),
            {value: toNano("0.1")},
            msg,
        )

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
            success: true,
        })

        const minterCode = jettonMinter.init?.code
        if (minterCode === undefined) {
            throw new Error("JettonMinter init is not defined")
        } else {
            _minter_code = minterCode
        }

        jettonWallet = blockchain.openContract(
            await WalletWrapper.fromInit(deployer.address, jettonMinter.address, 0n),
        )
        const walletCode = jettonWallet.init?.code
        if (walletCode === undefined) {
            throw new Error("JettonWallet init is not defined")
        } else {
            _jwallet_code = walletCode
        }

        userWallet = async (address: Address) => {
            return blockchain.openContract(
                new WalletWrapper(await jettonMinter.getGetWalletAddress(address)),
            )
        }

        snapshot = blockchain.snapshot()
    })

    beforeEach(async () => {
        await blockchain.loadFrom(snapshot)
    })

    it("Can close minting", async () => {
        const closeMinting: CloseMinting = {
            $$type: "CloseMinting",
        }
        const unsuccessfulCloseMinting = await jettonMinter.send(
            notDeployer.getSender(),
            {value: toNano("0.1")},
            closeMinting,
        )
        expect(unsuccessfulCloseMinting.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: JettonMinter.errors["Incorrect sender"],
        })
        expect((await jettonMinter.getGetJettonData()).mintable).toBeTruthy()

        const successfulCloseMinting = await jettonMinter.send(
            deployer.getSender(),
            {value: toNano("0.1")},
            closeMinting,
        )
        expect(successfulCloseMinting.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            success: true,
        })
        expect((await jettonMinter.getGetJettonData()).mintable).toBeFalsy()

        const mintMsg: Mint = {
            $$type: "Mint",
            queryId: 0n,
            receiver: deployer.address,
            tonAmount: toNano("0.1"),
            mintMessage: {
                $$type: "JettonTransferInternal",
                queryId: 0n,
                amount: toNano("0.1"),
                sender: deployer.address,
                responseDestination: deployer.address,
                forwardPayload: beginCell().storeUint(0, 1).endCell().asSlice(),
                forwardTonAmount: 0n,
            },
        }
        const mintTryAfterClose = await jettonMinter.send(
            deployer.getSender(),
            {value: toNano("0.1")},
            mintMsg,
        )
        expect(mintTryAfterClose.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            aborted: true,
            exitCode: JettonMinter.errors["Mint is closed"],
        })
    })

    it("should report correct balance", async () => {
        const jettonMintAmount = 100n
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            jettonMintAmount,
            0n,
            toNano(1),
        )
        const deployerJettonWallet = await userWallet(deployer.address)
        const jettonBalance = await deployerJettonWallet.getJettonBalance()

        const provideResult = await deployerJettonWallet.sendProvideWalletBalance(
            deployer.getSender(),
            toNano(1),
            notDeployer.address,
            false,
        )

        const msg: TakeWalletBalance = {
            $$type: "TakeWalletBalance",
            balance: jettonBalance,
            verifyInfo: null,
        }

        expect(provideResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: notDeployer.address,
            body: beginCell().store(storeTakeWalletBalance(msg)).endCell(),
        })
    })

    it("should report with correct verify info", async () => {
        const jettonMintAmount = 100n
        await jettonMinter.sendMint(
            deployer.getSender(),
            deployer.address,
            jettonMintAmount,
            0n,
            toNano(1),
        )
        const deployerJettonWallet = await userWallet(deployer.address)
        const jettonBalance = await deployerJettonWallet.getJettonBalance()

        const provideResult = await deployerJettonWallet.sendProvideWalletBalance(
            deployer.getSender(),
            toNano(1),
            notDeployer.address,
            true,
        )

        const msg: TakeWalletBalance = {
            $$type: "TakeWalletBalance",
            balance: jettonBalance,
            verifyInfo: {
                $$type: "VerifyInfo",
                owner: deployer.address,
                minter: jettonMinter.address,
                code: _jwallet_code,
            },
        }

        expect(provideResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: notDeployer.address,
            body: beginCell().store(storeTakeWalletBalance(msg)).endCell(),
        })
    })

    it("should claim all tons from minter", async () => {
        await deployer.send({
            to: jettonMinter.address,
            value: toNano(5),
            bounce: false,
        })

        const minterBalance = (await blockchain.getContract(jettonMinter.address)).balance

        // external -> claim request -> claim take
        const claimTonMinterResult = await jettonMinter.sendClaimTon(
            deployer.getSender(),
            notDeployer.address,
            toNano(1),
        )

        const claimTxTotalFees = claimTonMinterResult.transactions[1]!.totalFees.coins

        const claimInMsg = claimTonMinterResult.transactions[0]!.outMessages.get(0)!

        if (claimInMsg.info.type !== "internal") {
            // fail with expect
            fail("Expected the message type to not be 'internal")
        }

        const claimInMsgValue = claimInMsg.info.value.coins

        const claimOutMsg = claimTonMinterResult.transactions[1]!.outMessages.get(0)!

        if (claimOutMsg.info.type !== "internal") {
            // fail with expect
            fail("Expected the message type to not be 'internal")
        }

        const claimOutMsgFwdFee = claimOutMsg.info.forwardFee

        const expectedOutValue =
            minterBalance +
            claimInMsgValue -
            claimTxTotalFees -
            minTonsForStorage -
            claimOutMsgFwdFee

        const minterBalanceAfter = (await blockchain.getContract(jettonMinter.address)).balance
        expect(minterBalanceAfter).toEqual(minTonsForStorage)

        expect(claimTonMinterResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: notDeployer.address,
            value: expectedOutValue,
            success: true,
        })
    })

    it("should claim all tons from wallet", async () => {
        // mint to deploy wallet with correct state init
        await jettonMinter.sendMint(deployer.getSender(), deployer.address, 1000n, 0n, toNano(1))
        const deployerJettonWallet = await userWallet(deployer.address)

        await deployer.send({
            to: deployerJettonWallet.address,
            value: toNano(5),
            bounce: false,
        })

        const walletBalance = (await blockchain.getContract(deployerJettonWallet.address)).balance

        // external -> claim request -> claim take
        const claimTonJettonWalletResult = await deployerJettonWallet.sendClaimTon(
            deployer.getSender(),
            notDeployer.address,
            toNano(1),
        )

        const claimTxTotalFees = claimTonJettonWalletResult.transactions[1]!.totalFees.coins

        const claimInMsg = claimTonJettonWalletResult.transactions[0]!.outMessages.get(0)!

        if (claimInMsg.info.type !== "internal") {
            fail("Expected the message type to not be 'internal")
        }

        const claimInMsgValue = claimInMsg.info.value.coins

        const claimOutMsg = claimTonJettonWalletResult.transactions[1]!.outMessages.get(0)!

        if (claimOutMsg.info.type !== "internal") {
            fail("Expected the message type to not be 'internal")
        }

        const claimOutMsgFwdFee = claimOutMsg.info.forwardFee

        const expectedOutValue =
            walletBalance +
            claimInMsgValue -
            claimTxTotalFees -
            minTonsForStorage -
            claimOutMsgFwdFee

        const jettonWalletBalanceAfter = (
            await blockchain.getContract(deployerJettonWallet.address)
        ).balance
        expect(jettonWalletBalanceAfter).toEqual(minTonsForStorage)

        expect(claimTonJettonWalletResult.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: notDeployer.address,
            value: expectedOutValue,
            success: true,
        })
    })

    it("should bounce claim with low balance", async () => {
        const jwState = (await blockchain.getContract(jettonMinter.address)).account
        jwState.account!.storage.balance.coins = 1n
        await blockchain.setShardAccount(jettonMinter.address, jwState)

        const minterBalance = (await blockchain.getContract(jettonMinter.address)).balance

        const sendValue = toNano(0.009)
        expect(minterBalance + sendValue).toBeLessThan(minTonsForStorage)

        // external -> claim request -> bounce back
        const claimTonMinterResult = await jettonMinter.sendClaimTon(
            deployer.getSender(),
            notDeployer.address,
            sendValue,
        )

        expect(claimTonMinterResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            success: false,
            // https://github.com/ton-blockchain/ton/blob/303e92b7750dc443ae6c282fb478d2114079d216/crypto/block/transaction.cpp#L2860
            actionResultCode: JettonMinter.errors["Not enough Toncoin"],
        })

        expect(claimTonMinterResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployer.address,
            inMessageBounced: true,
        })
    })

    describe("Tact-way fees", () => {
        it("transfers with specified gas", async () => {
            const jettonMintAmount = 0n
            await jettonMinter.sendMint(
                deployer.getSender(),
                deployer.address,
                jettonMintAmount,
                0n,
                toNano(1),
            )
            const deployerJettonWallet = await userWallet(deployer.address)
            const randomNewReceiver = randomAddress(0)
            const sendResult = await deployerJettonWallet.sendTransfer(
                deployer.getSender(),
                toNano("0.1"), // tons
                0n, // Transfer 0 jettons, it doesn't affect the fee
                randomNewReceiver,
                deployer.address,
                null,
                toNano("0.05"),
                null,
            )
            // NOTE: here we use constant from contract source code itself
            // for both send and receive transactions, since basically it approximates the maximum
            // of them two, making it easier to perform gas checks it Tact and it's sufficient enough

            // From sender to jw
            console.log("Gas for send transfer", getComputeGasForTx(sendResult.transactions[1]!))
            expect(getComputeGasForTx(sendResult.transactions[1]!)).toBeLessThanOrEqual(
                gasForTransfer,
            )
            // From jw to jw
            console.log(
                "Gas for receive (internal) transfer",
                getComputeGasForTx(sendResult.transactions[2]),
            )
            expect(getComputeGasForTx(sendResult.transactions[2])).toBeLessThanOrEqual(
                gasForTransfer,
            )
        })

        it("Burns with specified gas", async () => {
            const jettonMintAmount = 0n
            await jettonMinter.sendMint(
                deployer.getSender(),
                deployer.address,
                jettonMintAmount,
                0n,
                toNano(1),
            )
            const deployerJettonWallet = await userWallet(deployer.address)
            const sendResult = await deployerJettonWallet.sendBurn(
                deployer.getSender(),
                toNano(0.1),
                0n, // Burn 0 jettons, it doesn't affect the fee
                deployer.address,
                null,
            )
            // Same here as in transfers with single constant

            // From deployer to jw
            console.log("Gas for send burn", getComputeGasForTx(sendResult.transactions[1]!))
            expect(getComputeGasForTx(sendResult.transactions[1]!)).toBeLessThanOrEqual(gasForBurn)
            // From jw to jetton_master
            console.log("Gas for receive burn", getComputeGasForTx(sendResult.transactions[2]))
            expect(getComputeGasForTx(sendResult.transactions[2])).toBeLessThanOrEqual(gasForBurn)
        })

        // add tests here that send with minimal required value passes
        it("jetton transfer with minimal required value passes", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const jettonTransferAmount = 100n
            const forwardTonAmount = toNano(0.1)

            const gasPrices = getGasPrices(blockchain.config, 0)
            const transferGasPrice = computeGasFee(gasPrices, gasForTransfer)

            const transferMsg = beginCell()
                .store(
                    storeJettonTransfer({
                        $$type: "JettonTransfer",
                        amount: jettonTransferAmount,
                        customPayload: null,
                        destination: notDeployer.address,
                        queryId: 0n,
                        forwardTonAmount: forwardTonAmount,
                        forwardPayload: beginCell().storeMaybeRef(null).endCell().asSlice(),
                        responseDestination: deployer.address,
                    }),
                )
                .endCell()

            // make transfer to get fwd fee from it
            const transferForCalc = await deployer.send({
                to: deployerJettonWallet.address,
                value: toNano(10),
                body: transferMsg,
                bounce: false,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
            })

            const fwdTx = findTransactionRequired(transferForCalc.transactions, {
                from: deployer.address,
                to: deployerJettonWallet.address,
            })

            const inFwdFee =
                fwdTx.inMessage?.info.type === "internal"
                    ? fwdTx.inMessage.info.forwardFee
                    : undefined
            if (inFwdFee === undefined) {
                throw new Error("Could not find inFwdFee")
            }
            const prices = getMsgPrices(blockchain.config, 0)
            // https://github.com/ton-blockchain/ton/commit/a11ffb1637032faabea9119020f6c80ed678d0e7#diff-660b8e8615c63abdc65b4dfb7dba42b4c3f71642ca33e5ee6ae4e344a7eb082dR371
            const origFwdFee = getOriginalFwdFee(prices, inFwdFee)
            /*
            require(
                ctx.value >
                msg.forwardTonAmount +
                fwdCount * ctx.readForwardFee() +
                (2 * getComputeFee(gasForTransfer, false) + minTonsForStorage),
                "Insufficient amount of TON attached",
            );
            */
            const minimalTransferValue =
                transferGasPrice * 2n + minTonsForStorage + origFwdFee * 2n + forwardTonAmount + 1n // +1 to be greater than

            // mint to deploy jetton wallet
            const jettonMintAmount = 1000000n
            await jettonMinter.sendMint(
                deployer.getSender(),
                deployer.address,
                jettonMintAmount,
                0n,
                toNano(1),
            )

            // actual send with minimal value
            const sendResult = await deployer.send({
                to: deployerJettonWallet.address,
                value: minimalTransferValue,
                body: transferMsg,
                bounce: false,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
            })

            expect(sendResult.transactions).not.toHaveTransaction({
                success: false,
            })
        })

        it("jetton mint with minimal required value passes", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const jettonMintAmount = 100n
            const forwardTonAmount = toNano(0.1)

            const gasPrices = getGasPrices(blockchain.config, 0)
            const transferGasPrice = computeGasFee(gasPrices, gasForTransfer)

            const mintMsg = beginCell()
                .store(
                    storeMint({
                        $$type: "Mint",
                        queryId: 0n,
                        receiver: deployer.address,
                        tonAmount: forwardTonAmount,
                        mintMessage: {
                            $$type: "JettonTransferInternal",
                            queryId: 0n,
                            amount: jettonMintAmount,
                            sender: deployer.address,
                            responseDestination: deployer.address,
                            forwardPayload: beginCell().storeMaybeRef(null).endCell().asSlice(),
                            forwardTonAmount: forwardTonAmount,
                        },
                    }),
                )
                .endCell()

            // send mint (it will fail but that's okay) to get fwd fee from it
            const mintForCalc = await deployer.send({
                to: deployerJettonWallet.address,
                value: toNano(10),
                body: mintMsg,
                bounce: false,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
            })

            const fwdTx = findTransactionRequired(mintForCalc.transactions, {
                from: deployer.address,
                to: deployerJettonWallet.address,
            })

            const inFwdFee =
                fwdTx.inMessage?.info.type === "internal"
                    ? fwdTx.inMessage.info.forwardFee
                    : undefined
            if (inFwdFee === undefined) {
                throw new Error("Could not find inFwdFee")
            }
            const prices = getMsgPrices(blockchain.config, 0)
            // https://github.com/ton-blockchain/ton/commit/a11ffb1637032faabea9119020f6c80ed678d0e7#diff-660b8e8615c63abdc65b4dfb7dba42b4c3f71642ca33e5ee6ae4e344a7eb082dR371
            const origFwdFee = getOriginalFwdFee(prices, inFwdFee)

            /*
            require(
                ctx.value >
                msg.forwardTonAmount +
                fwdCount * ctx.readForwardFee() +
                (2 * getComputeFee(gasForTransfer, false) + minTonsForStorage),
                "Insufficient amount of TON attached",
            );
            */
            const minimalMintValue =
                transferGasPrice * 2n + minTonsForStorage + origFwdFee * 2n + forwardTonAmount + 1n // +1 to be greater than

            // actual send with minimal value
            const mintSendResult = await deployer.send({
                to: jettonMinter.address,
                value: minimalMintValue,
                body: mintMsg,
                bounce: false,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
            })

            expect(mintSendResult.transactions).not.toHaveTransaction({
                success: false,
            })
        })

        it("jetton burn with minimal required value passes", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const jettonBurnAmount = 100n

            const gasPrices = getGasPrices(blockchain.config, 0)
            const burnGasPrice = computeGasFee(gasPrices, gasForBurn)

            const burnMsg = beginCell()
                .store(
                    storeJettonBurn({
                        $$type: "JettonBurn",
                        amount: jettonBurnAmount,
                        customPayload: null,
                        queryId: 0n,
                        responseDestination: deployer.address,
                    }),
                )
                .endCell()

            // make burn to get fwd fee from it
            const burnForCalc = await deployer.send({
                to: deployerJettonWallet.address,
                value: toNano(10),
                body: burnMsg,
                bounce: false,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
            })

            const fwdTx = findTransactionRequired(burnForCalc.transactions, {
                from: deployer.address,
                to: deployerJettonWallet.address,
            })

            const inFwdFee =
                fwdTx.inMessage?.info.type === "internal"
                    ? fwdTx.inMessage.info.forwardFee
                    : undefined
            if (inFwdFee === undefined) {
                throw new Error("Could not find inFwdFee")
            }
            const prices = getMsgPrices(blockchain.config, 0)
            // https://github.com/ton-blockchain/ton/commit/a11ffb1637032faabea9119020f6c80ed678d0e7#diff-660b8e8615c63abdc65b4dfb7dba42b4c3f71642ca33e5ee6ae4e344a7eb082dR371
            const origFwdFee = getOriginalFwdFee(prices, inFwdFee)

            /*
            require(
                ctx.value > 
                (fwdFee + 2 * getComputeFee(gasForBurn, false)),
                "Insufficient amount of TON attached"
            );
            */
            const minimalBurnValue = burnGasPrice * 2n + origFwdFee + 1n // +1 to be greater than

            // mint to deploy jetton wallet
            const jettonMintAmount = 1000000n
            await jettonMinter.sendMint(
                deployer.getSender(),
                deployer.address,
                jettonMintAmount,
                0n,
                toNano(1),
            )

            // actual send with minimal value
            const sendResult = await deployer.send({
                to: deployerJettonWallet.address,
                value: minimalBurnValue,
                body: burnMsg,
                bounce: false,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
            })

            expect(sendResult.transactions).not.toHaveTransaction({
                success: false,
            })
        })
    })
})
