# Face-positioning model

The unmodified BlazeFace short-range model comes from Google's official MediaPipe model distribution:
https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite

It is served locally for optional on-device face-positioning guidance. It does not establish identity, document authenticity, or biometric liveness. The pinned MediaPipe runtime is copied from the npm lockfile during builds.
