import { describe, expect, test } from '@jest/globals'

import { CommandBus } from './commandBus'
import { Command } from './models/command.model'

describe('CommandBus', () => {
    describe('decorate with @CommandBus.handler', () => {
        test('should register command handler', () => {
            class TestCommand extends Command<string> {
                constructor(public readonly id: string) {
                    super()
                }
            }

            class TestCommandBus extends CommandBus {}

            const commandBus = new TestCommandBus()

            @commandBus.handler(TestCommand)
            class TestCommandHandler {
                public execute(command: TestCommand) {
                    return command.id + 1
                }
            }

            const testCommandHandler = new TestCommandHandler()

            expect(testCommandHandler).toBeInstanceOf(TestCommandHandler)

            const command = new TestCommand('test')

            const result = commandBus.run(command)

            expect(result).toBe('test')
        })
    })
})
