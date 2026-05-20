# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# VisionCamera Frame Processor - prevent obfuscation
-keep class com.mrousavy.camera.** { *; }
-keep interface com.mrousavy.camera.** { *; }
-keepclassmembers class com.mrousavy.camera.** { *; }
-keep class com.mrousavy.camera.frameprocessors.** { *; }
-keep interface com.mrousavy.camera.frameprocessors.** { *; }
-keepclassmembers class com.mrousavy.camera.frameprocessors.** { *; }
-keepclassmembers class com.mrousavy.camera.frameprocessors.SharedArray { *; }
-keepclassmembers class com.mrousavy.camera.frameprocessors.FrameProcessor { *; }
-dontwarn com.mrousavy.camera.**
