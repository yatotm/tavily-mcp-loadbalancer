import { serializePayloadForLog } from './logging-utils';

describe('logging-utils', () => {
  it('redacts nested sensitive fields before serializing', () => {
    const payload = {
      detail: [
        {
          msg: 'Field required',
          input: {
            api_key: 'secret-key',
            raw_input: {
              Authorization: 'Bearer secret-key',
              token: 'abc',
            },
          },
        },
      ],
    };

    const serialized = serializePayloadForLog(payload);

    expect(serialized).toContain('"api_key":"***"');
    expect(serialized).toContain('"Authorization":"***"');
    expect(serialized).toContain('"token":"***"');
    expect(serialized).not.toContain('secret-key');
  });
});
