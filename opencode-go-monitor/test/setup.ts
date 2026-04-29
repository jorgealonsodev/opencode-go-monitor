import { vi } from 'vitest';
import { mockVscode } from './mockvscode';

// Provide the vscode module mock globally for all tests
vi.mock('vscode', () => mockVscode);
