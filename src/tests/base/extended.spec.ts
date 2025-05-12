import {Address, beginCell, Cell, SendMode, toNano} from "@ton/core"
import {Blockchain, BlockchainSnapshot, SandboxContract, TreasuryContract} from "@ton/sandbox"
import {ExtendedJettonWallet} from "../../wrappers/ExtendedJettonWallet"
import {ExtendedJettonMinter} from "../../wrappers/ExtendedJettonMinter"
import {ExtendedFeatureRichJettonWallet} from "../../wrappers/ExtendedFeatureRichJettonWallet"
import {ExtendedFeatureRichJettonMinter} from "../../wrappers/ExtendedFeatureRichJettonMinter"
import {ExtendedShardedJettonWallet} from "../../wrappers/ExtendedShardedJettonWallet"
import {ExtendedShardedJettonMinter} from "../../wrappers/ExtendedShardedJettonMinter"
import {findTransactionRequired, randomAddress} from "@ton/test-utils"
import {
    computeGasFee,
    getGasPrices,
    getMsgPrices,
    getOriginalFwdFee,
} from "../governance-tests/gasUtils"
import {
    CloseMinting,
    JettonMinter,
    JettonUpdateContent,
    Mint,
    minTonsForStorage,
    storeJettonBurn,
    storeJettonTransfer,
    storeTakeWalletBalance,
    TakeWalletBalance,
} from "../../output/Shard_JettonMinter"
import {JettonWallet} from "../../output/Shard_JettonWallet"

import {getComputeGasForTx} from "../../utils/gas"

// Use describe.each to parameterize the test suite for both base and feature-rich jetton versions
describe.each([
    // {
    //     name: "Base Jetton",
    //     MinterWrapper: ExtendedJettonMinter,
    //     WalletWrapper: ExtendedJettonWallet,
    // },
    // {
    //     name: "Feature Rich Jetton",
    //     MinterWrapper: ExtendedFeatureRichJettonMinter,
    //     WalletWrapper: ExtendedFeatureRichJettonWallet,
    // },
    {
        name: "Shard Jetton",
        MinterWrapper: ExtendedShardedJettonMinter,
        WalletWrapper: ExtendedShardedJettonWallet,
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

        _jwallet_code = (await JettonWallet.fromInit(deployer.address, jettonMinter.address, 0n))
            .init?.code!

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
                // code: Cell.fromHex("b5ee9c72010210010004ef00022cff008e88f4a413f4bcf2c80bed53208e8130e1ed43d901020033a65ec0bb51343e903e903e8015481b04fe0a95185014901b0d20049401d072d721d200d200fa4021103450666f04f86102f862ed44d0fa40fa40fa0055206c1304e30202d70d1ff2e0822182100f8a7ea5bae302218210178d4519bae3022182107ac8d559ba0304050600b2028020d7217021d749c21f9430d31f01de208210178d4519ba8e1930d33ffa00596c2113a0c855205acf1658cf1601fa02c9ed54e082107bdd97deba8e18d33ffa00596c2113a0c855205acf1658cf1601fa02c9ed54e05f0401fe31d33ffa00fa4020d70b01c30093fa40019472d7216de201f404fa0051661615144330323622fa4430f2d08a8123fff8425280c705f2f45183a181093e21c2fff2f428f404016e913091d1e2f8416f2429b8a4541432817d7106fa40fa0071d721fa00fa00306c6170f83a12a85280a081290470f836aa008208989680a0a00701f831d33ffa00fa4020d70b01c30093fa40019472d7216de201fa00515515144330365183a0532770f82ac855215acf1658cf1601fa02c9f842fa443159c87101cb007801cb047001cb0012f400f4007001cb00c9f900206ef2d08084f7b00184f7b0ba9a8123fff84229c705f2f4dff8416f2421f8276f1021a12ec2000902fe8e6331fa40d200596d339931f82a4330126f0301926c22e259c8598210ca77fdc25003cb1f01fa02216eb38e137f01ca0001206ef2d0806f235acf1658cf16cc947032ca00e2c90170804043137fc8cf8580ca00cf8440ce01fa02806acf40f400c901fb00e0218210595f07bcbae302333302820b93b1cebae3025bf2c0820d0e01b4bcf2f450437080407f294813509cc855508210178d45195007cb1f15cb3f5003fa0201cf1601206e9430cf848092cf16e201fa0201cf16c9543167f82ac855215acf1658cf1601fa02c9f84278d70130106910491056103510340800d03333c87101cb007801cb047001cb00f40012f4007001cb00c9c87401cb027001cb0721f90084f7b003aaf713b158cbffc9d0fa4431c87401cb027001cb07cbffc9d0c8801801cb0501cf1670fa027701cb6bccccc901fb0002c855205acf1658cf1601fa02c9ed5403fa8e5c5531fa40fa0071d721fa00fa00306c6170f83a52b0a012a17170284813507ac8553082107362d09c5005cb1f13cb3f01fa0201cf1601cf16c92804103b4655441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0006503396107e106b6c82e28208989680b60972fb02256eb39320c2009170e2e30f020a0b0c007205206ef2d0808100827003c8018210d53276db58cb1fcb3fc9102410374170441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0000045b33001ec855205acf1658cf1601fa02c9ed5401c831d33ffa0020d70b01c30093fa40019472d7216de201f404553030338123fff8425250c705f2f45155a181093e21c2fff2f4f8416f2443305230fa40fa0071d721fa00fa00306c6170f83a817d71811a2c70f836aa0012a012bcf2f47080405413757f060f006cfa4001318123fff84213c70512f2f482089896808010fb027083066d40037fc8cf8580ca00cf8440ce01fa02806acf40f400c901fb0000a0c8553082107bdd97de5005cb1f13cb3f01fa0201cf1601206e9430cf848092cf16e2c9254744441359c8cf8580ca00cf8440ce01fa02806acf40f400c901fb0002c855205acf1658cf1601fa02c9ed54"),
                code: _jwallet_code,
            },
        }

        // console.log((await blockchain.getContract(deployerJettonWallet.address)).accountState)
        // console.log(_jwallet_code.hash().toString("hex"))
        // expect(_jwallet_code).toBe((await blockchain.getContract(deployerJettonWallet.address)).accountState)
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
                jettonMinter.loadGasForTransfer(),
            )
            // From jw to jw
            console.log(
                "Gas for receive (internal) transfer",
                getComputeGasForTx(sendResult.transactions[2]),
            )
            expect(getComputeGasForTx(sendResult.transactions[2])).toBeLessThanOrEqual(
                jettonMinter.loadGasForTransfer(),
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
            expect(getComputeGasForTx(sendResult.transactions[1]!)).toBeLessThanOrEqual(
                jettonMinter.loadGasForBurn(),
            )
            // From jw to jetton_master
            console.log("Gas for receive burn", getComputeGasForTx(sendResult.transactions[2]))
            expect(getComputeGasForTx(sendResult.transactions[2])).toBeLessThanOrEqual(
                jettonMinter.loadGasForBurn(),
            )
        })

        // add tests here that send with minimal required value passes
        it("jetton transfer with minimal required value passes", async () => {
            const deployerJettonWallet = await userWallet(deployer.address)
            const jettonTransferAmount = 100n
            const forwardTonAmount = toNano(0.1)

            const gasPrices = getGasPrices(blockchain.config, 0)
            const transferGasPrice = computeGasFee(gasPrices, jettonMinter.loadGasForTransfer())

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
            const transferGasPrice = computeGasFee(gasPrices, jettonMinter.loadGasForTransfer())

            const mintMsg = jettonMinter.loadMintMessage(
                jettonMintAmount,
                deployer.address,
                deployer.address,
                deployer.address,
                forwardTonAmount,
                null,
            )

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
            const burnGasPrice = computeGasFee(gasPrices, jettonMinter.loadGasForBurn())

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
