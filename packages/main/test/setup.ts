import { setLogLevel } from '../src/logging/index.js';

/** Keeps test output to failures: the modules under test log at info and below. */
setLogLevel('error');
