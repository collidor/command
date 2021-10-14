export class InvalidQueueHandlerException extends Error {
    constructor(command?: string, commandBus?: string) {
        super(
            `The handler for the command ${command} is not registered for the command bus ${commandBus}`,
        )
    }
}
