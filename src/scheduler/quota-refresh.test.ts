import { QuotaRefresher } from './quota-refresh';

type Key = { id: number; status: string };

const makeRefresher = (
  keys: Key[],
  quotaFor: (id: number) => { quota_limit: number | null; used_count: number }
) => {
  const updateStatus = jest.fn();
  const resetErrors = jest.fn();
  const ensureMonthlyQuota = jest.fn((id: number) => quotaFor(id));
  const db = {
    getApiKeys: () => keys,
    ensureMonthlyQuota,
  } as any;
  const keyPool = { updateStatus, resetErrors } as any;
  return { refresher: new QuotaRefresher(db, keyPool), updateStatus, resetErrors, ensureMonthlyQuota };
};

describe('QuotaRefresher.refresh', () => {
  it('reactivates quota_exceeded key when monthly usage is below limit', () => {
    const { refresher, updateStatus, resetErrors } = makeRefresher(
      [{ id: 4, status: 'quota_exceeded' }],
      () => ({ quota_limit: 1000, used_count: 0 })
    );
    refresher.refresh();
    expect(updateStatus).toHaveBeenCalledWith(4, 'active');
    expect(resetErrors).toHaveBeenCalledWith(4);
  });

  it('reactivates when quota_limit is null (unknown limit, treat as not exhausted)', () => {
    const { refresher, updateStatus } = makeRefresher(
      [{ id: 5, status: 'quota_exceeded' }],
      () => ({ quota_limit: null, used_count: 9999 })
    );
    refresher.refresh();
    expect(updateStatus).toHaveBeenCalledWith(5, 'active');
  });

  it('does not reactivate when used_count >= quota_limit', () => {
    const { refresher, updateStatus, resetErrors } = makeRefresher(
      [{ id: 6, status: 'quota_exceeded' }],
      () => ({ quota_limit: 1000, used_count: 1000 })
    );
    refresher.refresh();
    expect(updateStatus).not.toHaveBeenCalled();
    expect(resetErrors).not.toHaveBeenCalled();
  });

  it('ignores keys whose status is not quota_exceeded', () => {
    const { refresher, updateStatus } = makeRefresher(
      [
        { id: 1, status: 'active' },
        { id: 2, status: 'banned' },
        { id: 3, status: 'disabled' },
      ],
      () => ({ quota_limit: 1000, used_count: 0 })
    );
    refresher.refresh();
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
