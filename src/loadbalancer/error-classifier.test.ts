import { AxiosError } from 'axios';
import { classifyError, classifyResponsePayload } from './error-classifier';

describe('error-classifier', () => {
  it('extracts validation errors from detail arrays', () => {
    const result = classifyError(
      new AxiosError('Request failed'),
      {
        detail: [
          {
            type: 'missing',
            loc: ['body', 'query'],
            msg: 'Field required',
            input: { search_depth: 'advanced' },
          },
        ],
      },
      422
    );

    expect(result.type).toBe('client');
    expect(result.message).toBe('body.query: Field required');
  });

  it('extracts nested detail error messages', () => {
    const result = classifyError(
      new AxiosError('Request failed'),
      {
        detail: {
          error: "Invalid topic. Must be 'general', 'news', or 'finance'",
        },
      },
      400
    );

    expect(result.type).toBe('client');
    expect(result.message).toBe("Invalid topic. Must be 'general', 'news', or 'finance'");
  });

  it('classifies payload detail arrays as client errors', () => {
    const result = classifyResponsePayload({
      detail: [
        {
          type: 'missing',
          loc: ['body', 'query'],
          msg: 'Field required',
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.type).toBe('client');
    expect(result?.message).toBe('body.query: Field required');
  });

  it('classifies 432 with quota body as quota_exceeded, not auth', () => {
    const result = classifyError(
      new AxiosError('Request failed'),
      {
        detail: {
          error: "This request exceeds your plan's set usage limit. Please upgrade your plan or contact support@tavily.com",
        },
      },
      432
    );
    expect(result.type).toBe('quota_exceeded');
    expect(result.shouldDisableKey).toBe(true);
    expect(result.incrementErrorCount).toBe(true);
  });

  it('classifies 433 with quota body as quota_exceeded', () => {
    const result = classifyError(
      new AxiosError('Request failed'),
      { detail: { error: 'Monthly credit usage limit exceeded.' } },
      433
    );
    expect(result.type).toBe('quota_exceeded');
    expect(result.shouldDisableKey).toBe(true);
  });

  it('keeps 401 as auth even when body mentions quota-like words', () => {
    const result = classifyError(
      new AxiosError('Request failed'),
      { detail: { error: 'Invalid api key' } },
      401
    );
    expect(result.type).toBe('auth');
  });

  it('keeps 432 as auth when body has no quota keywords', () => {
    const result = classifyError(
      new AxiosError('Request failed'),
      { detail: { error: 'Invalid signature' } },
      432
    );
    expect(result.type).toBe('auth');
  });
});
