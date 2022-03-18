import { Plugin } from "../interfaces/plugin.interface"
import { Command } from "../models"
import { composePlugins } from "./composePlugins"

describe('composePLugins', () => {
    class CommandToString<T = any> extends Command<T & string> {}

    const plugin1: Plugin<Command<number>, CommandToString> = (onExecute) => {
        return ()
    }

    it('', () => {
        expect(composePlugins(plugin1)).toBeDefined()
    })
})