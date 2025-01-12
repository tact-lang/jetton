import { Address, beginCell, Cell, ContractProvider, Sender, toNano, Builder } from '@ton/core';
import {
    Blockchain,
    SandboxContract,
    TreasuryContract,
    internal,
    printTransactionFees, BlockchainTransaction
} from "@ton/sandbox";


import {
    ChangeOwner,
    JettonMinter,
    Mint,
    TokenUpdateContent,
    Deploy,
    TokenBurn, ProvideWalletAddress
} from './output/Jetton_JettonMinter';
import { JettonWallet, TokenTransfer } from "./output/Jetton_JettonWallet";

import "@ton/test-utils";
import { randomAddress } from './utils/utils';
import { fromNano } from "@ton/ton";
import { flattenTransaction } from "@ton/test-utils";

function jettonContentToCell(content: {type: 0|1, uri:string}) {
    return beginCell()
        .storeUint(content.type, 8)
        .storeStringTail(content.uri) //Snake logic under the hood
        .endCell();
}
JettonMinter.prototype.getTotalSupply = async function (this: JettonMinter, provider: ContractProvider): Promise<bigint> {
    let res = await this.getGetJettonData(provider);
    return res.totalSupply;
};

JettonMinter.prototype.getWalletAddress = async function (this: JettonMinter, provider: ContractProvider, owner: Address) {
    return this.getGetWalletAddress(provider, owner);
};

JettonMinter.prototype.getAdminAddress = async function (this: JettonMinter, provider: ContractProvider) {
    return this.getOwner(provider);
};

JettonMinter.prototype.getContent = async function (this: JettonMinter, provider: ContractProvider) {
    let res = await this.getGetJettonData(provider);
    return res.jettonContent;
};

JettonMinter.prototype.sendMint = async function (
    this: JettonMinter,
    provider: ContractProvider,
    via: Sender,
    to: Address,
    jetton_amount: bigint,
    forward_ton_amount: bigint,
    total_ton_amount: bigint
) {
    if (total_ton_amount <= forward_ton_amount) {
        throw new Error("Total TON amount should be greater than the forward amount");
    }
    const msg: Mint = {
        $$type: "Mint",
        amount: jetton_amount,
        receiver: to,
    };
    return this.send(provider, via, { value: total_ton_amount + toNano("0.015") }, msg);
};

JettonMinter.prototype.sendChangeAdmin = async function (
    this: JettonMinter,
    provider: ContractProvider,
    via: Sender,
    newOwner: Address
) {
    const msg: ChangeOwner = {
        $$type: "ChangeOwner",
        queryId: 0n,
        newOwner: newOwner,
    };
    return this.send(provider, via, { value: toNano("0.05") }, msg);
};

JettonMinter.prototype.sendChangeContent = async function (
    this: JettonMinter,
    provider: ContractProvider,
    via: Sender,
    content: Cell
) {
    const msg: TokenUpdateContent = {
        $$type: "TokenUpdateContent",
        content: content,
    };
    return this.send(provider, via, { value: toNano("0.05") }, msg);
};

JettonMinter.prototype.sendDiscovery = async function (
    this: JettonMinter,
    provider: ContractProvider,
    via: Sender,
    address: Address,
    includeAddress: boolean,
    value: bigint = toNano("0.1")
) {
    const msg: ProvideWalletAddress = {
        $$type: "ProvideWalletAddress",
        query_id: 0n,
        owner_address: address,
        include_address: includeAddress,
    };
    return this.send(provider, via, { value: value }, msg);
};

const min_tons_for_storage: bigint = toNano("0.015");
const gas_consumption: bigint = toNano("0.015");
const fwd_fee: bigint = 721606n;

const Op = {
    token_transfer: 0xf8a7ea5,
    internal_transfer: 0x178d4519,
    transfer_notification: 0x7362d09c,
    token_burn: 0x595f07bc,
    burn_notification: 0x7bdd97de,
    token_excesses: 0xd53276db,
    provide_wallet_address: 0x2c76b973,
    take_wallet_address: 0xd1735400,
    mint: 0xfc708bd2,
}

function printTransaction(txs: BlockchainTransaction[]) {
    for(const tx of txs) {
        console.log(tx.events)
    }
}


describe("GasTests", () => {
    let blockchain: Blockchain;
    let jettonMinter: SandboxContract<JettonMinter>;
    let jettonWallet: SandboxContract<JettonWallet>;
    let deployer: SandboxContract<TreasuryContract>;

    let jwallet_code = new Cell();
    let minter_code = new Cell();
    let notDeployer: SandboxContract<TreasuryContract>;

    let userWallet: any;
    let defaultContent: Cell;
    beforeAll(async () => {
        // Create content Cell

        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury("deployer");
        notDeployer = await blockchain.treasury('notDeployer');

        defaultContent = beginCell().endCell();
        let msg: TokenUpdateContent = {
            $$type: "TokenUpdateContent",
            content: new Cell(),
        }


        jettonMinter = blockchain.openContract(await JettonMinter.fromInit(deployer.address, defaultContent));
        const deployResult = await jettonMinter.send(deployer.getSender(), {value: toNano("0.1")}, msg);

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            deploy: true,
            success: true,
        });
        minter_code = jettonMinter.init?.code!!;

        //const playerWallet = await jettonMinter.getGetWalletAddress(deployer.address);
        jettonWallet = blockchain.openContract(await JettonWallet.fromInit(deployer.address, jettonMinter.address));
        jwallet_code = jettonWallet.init?.code!!;

        userWallet = async (address: Address)=> {
            const newUserWallet = blockchain.openContract(
                JettonWallet.fromAddress(
                    await jettonMinter.getGetWalletAddress(address)
                )
            );
            (newUserWallet as any).getProvider = async (provider: ContractProvider) => {
                return provider;
            }

            const getJettonBalance = async(): Promise<bigint> => {
                let provider = await (newUserWallet as any).getProvider();
                let state = await provider.getState();
                if (state.state.type !== 'active') {
                    return 0n;
                }
                return (await newUserWallet.getGetWalletData()).balance;
            };

            const sendTransfer = async (
                via: Sender,
                value: bigint,
                jetton_amount: bigint,
                to: Address,
                responseAddress: Address,
                customPayload: Cell | null,
                forward_ton_amount: bigint,
                forwardPayload: Cell | null
            ) => {
                const parsedForwardPayload = forwardPayload != null ? forwardPayload.beginParse() : new Builder().storeUint(0, 1).endCell().beginParse(); //Either bit equals 0
                let msg: TokenTransfer = {
                    $$type: "TokenTransfer",
                    query_id: 0n,
                    amount: jetton_amount,
                    destination: to,
                    response_destination: responseAddress,
                    custom_payload: customPayload,
                    forward_ton_amount: forward_ton_amount,
                    forward_payload: parsedForwardPayload,
                };

                return await newUserWallet.send(via, { value }, msg);
            };

            const sendBurn = async (
                via: Sender,
                value: bigint,
                jetton_amount: bigint,
                responseAddress: Address,
                customPayload: Cell | null
            ) => {
                let msg: TokenBurn = {
                    $$type: "TokenBurn",
                    query_id: 0n,
                    amount: jetton_amount,
                    response_destination: responseAddress,
                    custom_payload: customPayload,
                };

                return await newUserWallet.send(via, { value }, msg);
            };

            return {
                ...newUserWallet,
                getJettonBalance,
                sendTransfer,
                sendBurn,
            };
        }
    });

    it('find minimal fee for transfer to new wallet', async () => {
        //REMEMBER to remove gas checks in jettons!!!
        const mintResult = await jettonMinter.sendMint(deployer.getSender(), deployer.address, toNano(100000), toNano('0.05'), toNano('1'));
        const deployerJettonWallet = await userWallet(deployer.address);
        expect(mintResult.transactions).toHaveTransaction({
            from: jettonMinter.address,
            to: deployerJettonWallet.address,
            success: true,
            endStatus: 'active'
        })
        const someAddress = Address.parse("EQD__________________________________________0vo");
        const someJettonWallet = await userWallet(someAddress);
        let L = 1n;
        let R = toNano(1);
        while (R - L > 1) {
            let M = (L + R) / 2n;
            const sendResult = await deployerJettonWallet.sendTransfer(deployer.getSender(), M, 1, someAddress, deployer.address, null, 0, null);
            try {
                expect(sendResult.transactions).not.toHaveTransaction({
                    success: false,
                });
                R = M;
            }
            catch {
                L = M;
            }
        }
        const finalSending = await deployerJettonWallet.sendTransfer(deployer.getSender(), R, 1, someAddress, deployer.address, null, 0, null);
        console.log("Minimal transfer fee is");
        console.log(fromNano(R));
        //printTransactionFees(finalSending.transactions);
        expect(finalSending.transactions).not.toHaveTransaction({
            success: false,
        })
        expect(finalSending.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: someJettonWallet.address,
            success: true,
            exitCode: 0,
        })
    })
    it('minimal burn message fee', async () => {
        const snapshot = blockchain.snapshot();
        const deployerJettonWallet = await userWallet(deployer.address);
        let initialJettonBalance   = await deployerJettonWallet.getJettonBalance();
        let initialTotalSupply     = await jettonMinter.getTotalSupply();
        let burnAmount   = toNano('0.01');
        //let minimalFee   = fwd_fee + 2n*gas_consumption + min_tons_for_storage;
        //let minimalFee = toNano("0.006");
        let L = toNano(0.00000001);
        let R = toNano(0.1);
        //implementing binary search
        while(R - L > 1) {
            let minimalFee = (L + R) / 2n;
            try {
                const sendLow= await deployerJettonWallet.sendBurn(deployer.getSender(), minimalFee, // ton amount
                    burnAmount, deployer.address, null); // amount, response address, custom payload

                expect(sendLow.transactions).toHaveTransaction({
                    from: deployerJettonWallet.address,
                    to: jettonMinter.address,
                    exitCode: 0
                });
                R = minimalFee;
            }
            catch {
                L = minimalFee;
            }
        }
        console.log(fromNano(L));
        await blockchain.loadFrom(snapshot);

        const sendEnough = await deployerJettonWallet.sendBurn(deployer.getSender(), L + 1n,
            burnAmount, deployer.address, null);

        expect(sendEnough.transactions).toHaveTransaction({
            from: deployerJettonWallet.address,
            to: jettonMinter.address,
            exitCode: 0,
        });
        //console.log(sendEnough.transactions[0].events);

        expect(await deployerJettonWallet.getJettonBalance()).toEqual(initialJettonBalance - burnAmount);
        expect(await jettonMinter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount);

    });
    it('Minimal discovery fee', async () => {
        // 5000 gas-units + msg_forward_prices.lump_price + msg_forward_prices.cell_price = 0.0061
        //const fwdFee     = 1464012n;
        //const minimalFee = fwdFee + 10000000n; // toNano('0.0061');

        let L = toNano(0.00000001);
        let R = toNano(0.1);
        //Binary search here does not affect on anything except time of test
        //So if you want to skip it, just replace while(R - L > 1) with while(false) or while(R - L > 1 && false)
        while(R - L > 1) {
            let minimalFee = (L + R) / 2n;
            try {
                const discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(), notDeployer.address, false, minimalFee);
                expect(discoveryResult.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: jettonMinter.address,
                    success: true
                });
                R = minimalFee;
            }
            catch {
                L = minimalFee;
            }
        }
        console.log(fromNano(L));
        const minimalFee = L;
        let discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
            notDeployer.address,
            false,
            minimalFee);
        flattenTransaction(discoveryResult.transactions[0])
        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            aborted: true,
            success: false,
        });
        discoveryResult = await jettonMinter.sendDiscovery(deployer.getSender(),
            notDeployer.address,
            false,
            minimalFee + 1n);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonMinter.address,
            success: true
        });

    });
})