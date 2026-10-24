# kotlinx.serialization: conservar los serializers generados de los modelos.
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class com.estradox.app.**$$serializer { *; }
-keepclassmembers class com.estradox.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.estradox.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
