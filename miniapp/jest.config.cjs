module.exports = {
    testEnvironment: 'jsdom',
    transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
    setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
    testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
};
