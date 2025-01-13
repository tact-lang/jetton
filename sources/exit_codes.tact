trait MinterExitcodes {
    const IncorrectSender: Int = 73;
    const InsufficientGasForDiscovery: Int = 75;
}

trait WalletExitcodes {
    const IncorrectSender: Int = 705;
    const IncorrectBalanceAfrerSend: Int = 706;
    const IncorrectSenderInternal: Int = 707;
    const UnsufficientAmountOfTonForBurn: Int = 707;
    const UnsufficientAmountOfTonAttached: Int = 709;
}