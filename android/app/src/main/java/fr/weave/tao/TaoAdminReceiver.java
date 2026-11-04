package fr.weave.tao;

// Récepteur d'administration : permet le vrai mode kiosque quand TAO est « propriétaire de l'appareil ».
// Activation (tablette réinitialisée, sans compte Google) :
//   adb shell dpm set-device-owner fr.weave.tao/.TaoAdminReceiver
import android.app.admin.DeviceAdminReceiver;

public class TaoAdminReceiver extends DeviceAdminReceiver {}
