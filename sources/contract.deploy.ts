//Huge thanks to Howard Peng for the original code of deploy script. https://github.com/howardpen9/jetton-implementation-in-tact

import { beginCell, contractAddress, toNano, TonClient4, WalletContractV4, internal, fromNano } from "@ton/ton";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { buildOnchainMetadata } from "./utils/jetton-helpers";

import { JettonMinter, storeMint } from "./output/Jetton_JettonMinter";

import { printSeparator } from "./utils/print";
import * as dotenv from "dotenv";
dotenv.config();


/*
    (Remember to install dependencies by running "yarn install" in the terminal)
    Here are the instructions to deploy the contract:
    1. Create new walletV4r2 or use existing one.
    2. Enter your mnemonics in .env file.
    3. On line 35 select the network you want to deploy the contract.
    (// - comments out the line, so you can switch between networks)
    (testnet is chosen by default, if you are not familiar with it, read https://tonkeeper.helpscoutdocs.com/article/100-how-switch-to-the-testnet)

    4. On lines 48-52 specify the parameters of the Jetton. (Ticker, description, image, etc.)
    5. On line 65 specify the total supply of the Jetton. It will be automatically converted to nano - jettons.
    Note: All supply will be automatically minted to your wallet.

    5. Run "yarn build" to compile the contract.
    6. Run this script by "yarn deploy"
 */


(async () => {
    //create client for testnet sandboxv4 API - alternative endpoint
    const client4 = new TonClient4({
        endpoint: "https://sandbox-v4.tonhubapi.com",
        //endpoint: "https://mainnet-v4.tonhubapi.com",
    });

    let mnemonics = (process.env.mnemonics || "").toString(); // 🔴 Change to your own, by creating .env file!
    let keyPair = await mnemonicToPrivateKey(mnemonics.split(" "));
    let secretKey = keyPair.secretKey;
    let workchain = 0; //we are working in basechain.
    let deployer_wallet = WalletContractV4.create({ workchain, publicKey: keyPair.publicKey });
    console.log(deployer_wallet.address);

    let deployer_wallet_contract = client4.open(deployer_wallet);

    const jettonParams = {
        name: "TactJetton",
        description: "This is description of Jetton, written in Tact-lang",
        symbol: "TACT",
        image: "https://raw.githubusercontent.com/tact-lang/tact/refs/heads/main/docs/public/logomark-light.svg",
    };

    // Create content Cell
    let content = buildOnchainMetadata(jettonParams);

    // Compute init data for deployment
    // NOTICE: the parameters inside the init functions were the input for the contract address
    // which means any changes will change the smart contract address as well
    let init = await JettonMinter.init(deployer_wallet_contract.address, content);
    let jettonMaster = contractAddress(workchain, init);
    let deployAmount = toNano("0.15");

    let supply = toNano(1000000000); // 🔴 Specify total supply in nano
    let packed_msg = beginCell()
        .store(
            storeMint({
                $$type: "Mint",
                query_id: 0n,
                amount: supply,
                receiver: deployer_wallet_contract.address,
            })
        )
        .endCell();

    // send a message on new address contract to deploy it
    let seqno: number = await deployer_wallet_contract.getSeqno();
    console.log("🛠️Preparing new outgoing massage from deployment wallet. \n" + deployer_wallet_contract.address);
    console.log("Seqno: ", seqno + "\n");
    printSeparator();

    // Get deployment wallet balance
    let balance: bigint = await deployer_wallet_contract.getBalance();

    console.log("Current deployment wallet balance = ", fromNano(balance).toString(), "💎TON");
    console.log("Minting:: ", fromNano(supply));
    printSeparator();

    await deployer_wallet_contract.sendTransfer({
        seqno,
        secretKey,
        messages: [
            internal({
                to: jettonMaster,
                value: deployAmount,
                init: {
                    code: init.code,
                    data: init.data,
                },
                body: packed_msg,
            }),
        ],
    });
    console.log("====== Deployment message sent to =======\n", jettonMaster);
})();
