import crypto from 'crypto'

beforeAll(() => {
  vi.stubGlobal('crypto', crypto)
})

describe('mc-bindings', () => {
  it('example test', () => {
    expect(true).toEqual(true)
  })
})
