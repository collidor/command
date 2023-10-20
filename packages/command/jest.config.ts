import type { Config } from '@jest/types'

const config: Config.InitialOptions = {
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                /**
                 * this reduces memory usage of ts-jest by treating each test file as a separate project
                 * @see https://huafu.github.io/ts-jest/user/config/isolatedModules
                 */
                // isolatedModules: true,
            },
        ],
    },
    testRegex: '\\.?(test|spec)\\.tsx?$',
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'svg'],
    modulePathIgnorePatterns: ['__mocks__', 'types'],
}

export default config
