'use strict';
/* The only errors whose identity may appear in public output. Each carries a reason code from a fixed list; the human-readable message is for local use and tests and is never printed. Anything else that is thrown (SDK errors, bugs) is reported only as "unexpected" with an HTTP status number if it has one. */
const REASONS = ['bad_arguments', 'key_in_argument', 'unknown_command', 'bad_endpoint', 'key_source_conflict', 'key_missing', 'key_file_in_repo', 'key_file_not_regular', 'key_file_mode', 'key_invalid', 'target_unrecorded', 'target_production', 'target_mismatch', 'rows_recorded', 'no_record', 'unsafe_line'];
class SafeError extends Error {
  constructor(reason, message) {
    if (!REASONS.includes(reason)) throw new Error('unknown reason code');
    super(message || reason); this.reason = reason;
  }
}
module.exports = { SafeError, REASONS };
