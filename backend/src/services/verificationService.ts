import db from '../db';
import { verifyTOTP, generateTOTP } from './totpService';

export interface VerifyRequest {
  door_code: string;
  code: string;
  method: 'totp' | 'face';
  timestamp: number;
}

export interface VerifyResult {
  success: boolean;
  message: string;
  token?: string;
}

/**
 * Verify access request and open door if authorized.
 */
export async function verifyAccess(
  request: VerifyRequest,
  userId: string,
): Promise<VerifyResult> {
  // Face verification not yet implemented
  if (request.method === 'face') {
    return {
      success: false,
      message: 'Face verification not yet enabled',
    };
  }

  // Validate TOTP code format (6 digits)
  if (!/^\d{6}$/.test(request.code)) {
    return {
      success: false,
      message: 'Invalid verification code format',
    };
  }

  try {
    // Find the door by door_code
    const door = await db('doors')
      .where({ door_code: request.door_code })
      .whereNull('deleted_at')
      .first();

    if (!door) {
      return {
        success: false,
        message: 'Door not found',
      };
    }

    // Check if door is active
    if (!door.active) {
      return {
        success: false,
        message: 'Door is not active',
      };
    }

    // Find matching TOTP secret for this door's building
    const totpSecret = await db('totp_secrets')
      .where({
        building_id: door.building_id,
        did: request.door_code, // using door_code as DID reference
      })
      .whereNull('deleted_at')
      .first();

    if (!totpSecret) {
      return {
        success: false,
        message: 'No TOTP secret configured for this door',
      };
    }

    // Verify the TOTP code
    const isValid = verifyTOTP(
      totpSecret.secret,
      request.code,
      totpSecret.digits,
      totpSecret.period, // stored as 'period' in DB, but speakeasy calls it 'step'
    );

    if (!isValid) {
      return {
        success: false,
        message: 'Invalid verification code',
      };
    }

    // Check if user has access to this door's building
    const userHasAccess = await db('users')
      .where({ id: userId })
      .where((query) => {
        query.where({ id: userId, current_building_id: door.building_id })
             .orWhere({ id: userId, all_buildings: true })
             .orWhereIn('id', () => {
               query.select('user_id').from('user_buildings').where({ building_id: door.building_id });
             });
      })
      .first();

    if (!userHasAccess) {
      return {
        success: false,
        message: 'You do not have access to this door',
      };
    }

    // Generate a temporary access token for the door event
    const accessToken = `access_${door.id}_${Date.now()}_${Math.random().toString(36).substring(2)}`;

    // Trigger door opening via MQTT (stub)
    await triggerDoorOpening(door.mqtt_topic, door.id.toString(), userId);

    return {
      success: true,
      message: 'Door opened successfully',
      token: accessToken,
    };
  } catch (error) {
    console.error('Verification error:', error);
    return {
      success: false,
      message: 'Verification failed. Please try again.',
    };
  }
}

/**
 * Stub for MQTT door opening. Replace with actual MQTT client.
 */
export async function triggerDoorOpening(
  mqttTopic: string,
  doorId: string,
  userId: string,
): Promise<void> {
  console.log(`[MQTT Stub] Publishing to topic: ${mqttTopic}`);
  console.log(`[MQTT Stub] Door ${doorId} opened by user ${userId}`);
  console.log(`[MQTT Stub] Payload: { "action": "open", "door_id": "${doorId}", "user_id": "${userId}", "timestamp": ${Date.now()} }`);
  // TODO: Replace with actual MQTT publish
  // await mqttClient.publish(mqttTopic, JSON.stringify({
  //   action: 'open',
  //   door_id: doorId,
  //   user_id: userId,
  //   timestamp: Date.now(),
  // }));
}
