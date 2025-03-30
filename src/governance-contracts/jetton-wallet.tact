import "./messages";
import "./constants";

contract JettonWallet(
    status: Int as uint4,
    balance: Int as coins,
    owner: Address,
    master: Address,
) {
    receive(msg: JettonTransfer) {
        forceBasechain(msg.destination);
        let isFromMaster = sender() == self.master;

        let outgoingTransfersAllowed = ((self.status & 1) == 0);

        require(outgoingTransfersAllowed || isFromMaster, "Contract is locked");
        require(sender() == self.owner || isFromMaster, "Incorrect sender");

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");

        checkEitherForwardPayload(msg.forwardPayload);

        let ctx = context();
        let fwdCount = 1 + sign(msg.forwardTonAmount); // msg.forwardTonAmount is coins, so it's non-negative
        let jettonWalletGasConsumption = getPrecompiledGasConsumption();
        let sendTransferGasConsumption = SendTransferGasConsumption;
        let receiveTransferGasConsumption = ReceiveTransferGasConsumption;
        if (jettonWalletGasConsumption != null) {
            sendTransferGasConsumption = jettonWalletGasConsumption!!;
            receiveTransferGasConsumption = jettonWalletGasConsumption!!;
        }

        require(
            ctx.value >
            msg.forwardTonAmount +
            fwdCount * ctx.readForwardFee() +
            forwardInitStateOverhead() + 
            getComputeFee(sendTransferGasConsumption, MyWorkchain) +
            getComputeFee(receiveTransferGasConsumption, MyWorkchain) +
            calculateJettonWalletMinStorageFee(),
            "Insufficient amount of TON attached",
        );

        deploy(DeployParameters {
            value: 0,
            mode: SendRemainingValue | SendBounceIfActionFail,
            bounce: true,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
            init: initOf JettonWallet(0, 0, msg.destination, self.master),
        });
    }

    receive(msg: JettonTransferInternal) {
        let incomingTransfersLocked = ((self.status & 2) == 2);
        require(!incomingTransfersLocked, "Incoming transfers are locked");
        self.balance += msg.amount;

        // This message should come only from master, or from other JettonWallet
        let wallet: StateInit = initOf JettonWallet(0, 0, msg.sender, self.master);
        if (!wallet.hasSameBasechainAddress(sender())) {
            require(self.master == sender(), "Incorrect sender");
        }

        if (msg.forwardTonAmount > 0) {
            message(MessageParameters {
                to: self.owner,
                value: msg.forwardTonAmount,
                mode: SendPayGasSeparately | SendBounceIfActionFail,
                bounce: false,
                body: JettonNotification { // 0x7362d09c -- Remind the new Owner
                    queryId: msg.queryId,
                    amount: msg.amount,
                    sender: msg.sender,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }
        // 0xd53276db -- Cashback to the original Sender
        if (msg.responseDestination != null) {
            let msgValue = context().value;
            let toLeaveOnBalance = myBalance() - msgValue + myStorageDue();
            nativeReserve(max(toLeaveOnBalance, calculateJettonWalletMinStorageFee()), ReserveAtMost);
            message(MessageParameters {
                to: msg.responseDestination!!,
                value: msgValue,
                mode: SendRemainingBalance + SendIgnoreErrors,
                bounce: false,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    receive(msg: JettonBurn) {
        // Only master can burn the balance of governance contract
        require(sender() == self.master, "Not owner");

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");

        let jettonWalletGasConsumption = SendBurnGasConsumption;
        if(getPrecompiledGasConsumption() != null) {
            jettonWalletGasConsumption = getPrecompiledGasConsumption()!!;
        }
        require(context().value > 
        getForwardFee(BurnNotificationCells, BurnNotificationBits, MyWorkchain) +
        getComputeFee(jettonWalletGasConsumption, MyWorkchain) +
        getComputeFee(ReceiveBurnGasConsumption, MyWorkchain),
        "Insufficient amount of TON attached");

        message(MessageParameters {
            to: self.master,
            value: 0,
            mode: SendRemainingValue | SendBounceIfActionFail,
            bounce: true,
            body: JettonBurnNotification {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
            }.toCell(),
        });
    }

    receive(msg: SetStatus) {
        require(sender() == self.master, "Incorrect sender");
        self.status = msg.status;
    }

    receive(_: TopUp) {}

    bounced(msg: bounced<JettonTransferInternal>) {
        self.balance += msg.amount;
    }

    bounced(msg: bounced<JettonBurnNotification>) {
        self.balance += msg.amount;
    }

    get fun get_wallet_data(): JettonWalletData {
        return JettonWalletData {
            balance: self.balance,
            owner: self.owner,
            minter: self.master,
            code: myCode(),
        };
    }
    get fun get_status(): Int {
        return self.status;
    }
}


inline fun checkEitherForwardPayload(forwardPayload: Slice) {
    if (forwardPayload.preloadUint(1) == 1) {
        let bitsAndRefs = caclulateSliceBitsAndRefs(forwardPayload);
        require(bitsAndRefs.refs == 1 && bitsAndRefs.bits == 1, "Invalid forward payload in message");
    }
}

struct SliceBitsAndRefs {
    bits: Int;
    refs: Int;
}

asm fun caclulateSliceBitsAndRefs(slice: Slice): SliceBitsAndRefs {
    SBITREFS
}

asm fun getPrecompiledGasConsumption(): Int? {
    GETPRECOMPILEDGAS
}

fun forwardInitStateOverhead(): Int {
    return getSimpleForwardFee(WalletStateInitSizeCells, WalletStateInitSizeBits, MyWorkchain);
}

inline fun calculateJettonWalletMinStorageFee(): Int {
    return getStorageFee(WalletStateInitSizeCells, WalletStateInitSizeBits, MinStorageDuration, MyWorkchain);
}
