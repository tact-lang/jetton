// https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md

import "./jetton-wallet";
import "./messages";
import "./constants";

const Workchain: Int = 0;

struct JettonMinterState {
    totalSupply: Int as coins;
    mintable: Bool;
    adminAddress: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;
}

contract JettonMinter(
    totalSupply: Int as coins,
    adminAddress: Address,
    nextAdminAddress: Address?,
    jettonContent: Cell,
    mintable: Bool, // Should be deployed with this flag set to true
) {
    receive(msg: Mint) {
        require(sender() == self.adminAddress, "Incorrect sender");
        require(parseStdAddress(msg.toAddress.asSlice()).workchain == Workchain, "Wrong workchain");

        // No need to check the opcode here, as Tact will check it automatically
        // throw_unless(error::invalid_op, master_msg_slice~load_op() == op::internal_transfer);

        checkEitherForwardPayload(msg.masterMsg.forwardPayload);

        let fwdCount = 1 + sign(msg.masterMsg.forwardTonAmount);
        let ctx = context();
        require(
            ctx.value >
            fwdCount * ctx.readForwardFee() +
            forwardInitStateOverhead() +
            getComputeFee(SendTransferGasConsumption, MyWorkchain) +
            getComputeFee(ReceiveTransferGasConsumption, MyWorkchain) +
            calculateJettonWalletMinStorageFee(),
            "Insufficient balance",
        );

        self.totalSupply += msg.masterMsg.amount;

        deploy(DeployParameters {
            value: 0,
            bounce: true,
            mode: SendRemainingValue | SendBounceIfActionFail,
            body: msg.masterMsg.toCell(),
            init: getJettonWalletInit(msg.toAddress),
        });
    }

    receive(msg: JettonBurnNotification) {
        let sender = parseStdAddress(sender().asSlice());
        let wallet = getJettonBasechainWalletByOwner(msg.sender);

        require(sender.workchain == Workchain && sender.address == wallet.hash!!, "Unauthorized burn");

        self.totalSupply -= msg.amount;

        if (msg.responseDestination != null) {
            message(MessageParameters {
                to: msg.responseDestination!!,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
                value: 0,
                bounce: false,
                mode: SendRemainingValue | SendIgnoreErrors, // ignore errors, because supply has already been updated
            });
        }
    }

    receive(msg: ProvideWalletAddress) {
        let ownerWorkchain: Int = parseStdAddress(msg.ownerAddress.asSlice()).workchain;

        let targetJettonWallet: BasechainAddress = (ownerWorkchain == Workchain)
            ? contractBasechainAddress(initOf JettonWallet(0, 0, msg.ownerAddress, myAddress()))
            : emptyBasechainAddress();

        message(MessageParameters {
            bounce: false,
            body: makeTakeWalletAddressMsg(targetJettonWallet, msg),
            to: sender(),
            value: 0,
            mode: SendRemainingValue | SendBounceIfActionFail,
        });
    }

    receive(msg: ChangeAdmin) {
        require(sender() == self.adminAddress, "Incorrect sender");
        self.nextAdminAddress = msg.newAdminAddress;
    }

    receive(msg: ClaimAdmin) {
        require(sender() == self.nextAdminAddress, "Not next admin");
        self.adminAddress = sender();
        self.nextAdminAddress = null;
    }

    // can be used to lock, unlock or reedem funds
    receive(msg: CallTo) {
        require(sender() == self.adminAddress, "Incorrect sender");
        let masterMsgSlice = msg.masterMsg.beginParse();
        let op = masterMsgSlice.loadUint(32);
        masterMsgSlice.skipBits(64); // skip queryId

        if (op == JettonTransferOpcode) {
            masterMsgSlice.loadCoins();
            masterMsgSlice.loadAddress();
            masterMsgSlice.loadAddress();
            masterMsgSlice.skipMaybeRef();
            let forwardTonAmount = masterMsgSlice.loadCoins();

            checkEitherForwardPayload(masterMsgSlice);

            let ctx = context();
            let fwdCount = 1 + sign(forwardTonAmount);
            require(
                ctx.value >
                fwdCount * ctx.readForwardFee() +
                getComputeFee(SendTransferGasConsumption, MyWorkchain) +
                getComputeFee(ReceiveTransferGasConsumption, MyWorkchain) +
                calculateJettonWalletMinStorageFee(),
                "Insufficient balance",
            );

            deploy(DeployParameters{
                bounce: false,
                value: msg.tonAmount,
                mode: SendRemainingValue,
                body: msg.masterMsg,
                init: getJettonWalletInit(msg.toAddress),
            });
        } else if (op == JettonBurnOpcode) { // JettonBurnNotification opcode
            masterMsgSlice.loadCoins();
            masterMsgSlice.loadAddress();
            masterMsgSlice.skipMaybeRef(); // customPayload
            masterMsgSlice.endParse();

            require(msg.tonAmount >=
                    getForwardFee(BurnNotificationCells, BurnNotificationBits, MyWorkchain) +
                    getComputeFee(SendBurnGasConsumption, MyWorkchain) +
                    getComputeFee(ReceiveBurnGasConsumption, MyWorkchain), "Insufficient funds for burn");
            
            deploy(DeployParameters{
                bounce: false,
                value: msg.tonAmount,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: msg.masterMsg,
                init: getJettonWalletInit(msg.toAddress),
            });

        } else if (op == SetStatusOpcode) { // SetStatus opcode
            masterMsgSlice.loadUint(4); // STATUS_SIZE = 4
            masterMsgSlice.endParse();

            deploy(DeployParameters{
                bounce: false,
                value: msg.tonAmount,
                mode: SendRemainingValue | SendIgnoreErrors,
                body: msg.masterMsg,
                init: getJettonWalletInit(msg.toAddress),
            });
        } else {
            throw(0xffff); // error::invalid_op
        }
    }

    receive(msg: ChangeMetadataUri) {
        require(sender() == self.adminAddress, "Incorrect sender");
        self.jettonContent = msg.metadata.asCell();
    }

    receive(msg: Upgrade) {
        require(sender() == self.adminAddress, "Incorrect sender");
        setData(msg.newData);
        setCode(msg.newCode);
        throw(0); // To avoid Tact storage saving
    }

    receive(_: TopUp) {}

    bounced(msg: bounced<JettonTransferInternal>) {
        self.totalSupply -= msg.amount;
    }

    get fun get_jetton_data(): JettonMinterState {
        return JettonMinterState {
            totalSupply: self.totalSupply,
            mintable: self.mintable,
            adminAddress: self.adminAddress,
            jettonContent: self.jettonContent,
            jettonWalletCode: codeOf JettonWallet,
        };
    }

    get fun get_wallet_address(ownerAddress: Address): Address {
        return getJettonWalletByOwner(ownerAddress);
    }

    get fun get_next_admin_address(): Address? {
        return self.nextAdminAddress;
    }
}

asm fun emptyAddress(): Address { b{00} PUSHSLICE }

inline fun makeTakeWalletAddressMsg(targetJettonWallet: BasechainAddress, msg: ProvideWalletAddress): Cell {
    return beginCell()
        .storeUint(TakeWalletAddressOpcode, 32)
        .storeUint(msg.queryId, 64)
        .storeBasechainAddress(targetJettonWallet)
        .storeMaybeRef(msg.includeAddress ? beginCell().storeAddress(msg.ownerAddress).endCell() : null)
        .endCell();
}

inline fun getJettonWalletInit(address: Address): StateInit {
    return initOf JettonWallet(0, 0, address, myAddress());
}

inline fun getJettonWalletByOwner(jettonWalletOwner: Address): Address {
    return contractAddress(getJettonWalletInit(jettonWalletOwner));
}

inline fun getJettonBasechainWalletByOwner(jettonWalletOwner: Address): BasechainAddress {
    return contractBasechainAddress(getJettonWalletInit(jettonWalletOwner));
}

asm fun setData(newData: Cell) {
    c4 POP
}

asm fun setCode(newCode: Cell) {
    SETCODE
}

