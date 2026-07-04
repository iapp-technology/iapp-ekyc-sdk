/// English strings for the iApp eKYC SDK.
const Map<String, String> ekycStringsEn = {
  // Document capture
  'searching_card': 'Position the document inside the frame',
  'hold_still': 'Hold still…',
  'too_blurry': 'Image is too blurry — hold the camera steady',
  'move_closer': 'Move closer to the document',
  'align_card': 'Align the document with the frame',
  'capturing': 'Capturing…',
  'uploading': 'Uploading…',
  'done': 'Done',
  'manual_capture': 'Capture manually',

  // Common actions
  'cancel': 'Cancel',
  'retry': 'Retry',
  'close': 'Close',
  'try_again': 'Try again',

  // Camera
  'camera_permission_denied':
      'Camera permission is required. Please allow camera access.',
  'camera_error': 'Camera could not be started',

  // Face positioning
  'position_face': 'Position your face inside the oval',
  'hold_face': 'Hold still, keep your face in the oval',
  'move_face_closer': 'Move closer to the camera',
  'center_face': 'Center your face in the oval',
  'look_straight': 'Look straight at the camera',
  'multiple_faces': 'Only one face should be in view',
  'face_lost': 'Face lost — please return to the oval',

  // Active liveness challenges
  'blink_now': 'Blink your eyes',
  'turn_left': 'Turn your head to the left',
  'turn_right': 'Turn your head to the right',
  'smile_now': 'Smile',
  'recenter_face': 'Look straight at the camera again',
  'challenge_passed': 'Great!',
  'liveness_success': 'Liveness check passed',
  'liveness_failed': 'Liveness check failed',
  'liveness_timeout': 'Time ran out — please try again',
  'too_many_restarts': 'Too many attempts — please try again',

  // Progress
  'processing': 'Processing…',
  'finalizing': 'Verifying…',
  'verifying': 'Verifying…',

  // Errors
  'error_generic': 'Something went wrong. Please try again.',
  'error_bad_request': 'The request was rejected. Please try again.',
  'error_invalid_key': 'Invalid API key. Please check your credentials.',
  'error_no_credit':
      'Insufficient credit. Please top up at iapp.co.th/control/credits.',
  'error_file_too_large': 'The image is too large (max 10 MB).',
  'error_rate_limited': 'Too many requests. Please wait and try again.',
  'error_server': 'Server error. Please try again later.',
  'error_network': 'Network error. Please check your connection.',
  'error_timeout': 'The request timed out. Please try again.',
};
