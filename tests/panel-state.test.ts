import { describe, expect, it } from 'vitest';
import { togglePanel } from '../src/client/panel-state';

describe('行程交付面板', () => {
  it('同一版本重复点击会展开再关闭，不同版本原地切换', () => {
    expect(togglePanel(null, 1)).toBe(1);
    expect(togglePanel(1, 1)).toBeNull();
    expect(togglePanel(1, 2)).toBe(2);
  });
});
