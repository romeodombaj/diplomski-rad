import { describe, it, expect } from 'vitest';
import { buildCommand, type LockDevice } from './lockService';

const lock = (over: Partial<LockDevice> = {}): LockDevice => ({
  id: 1,
  name: 'Test lock',
  address: 'plug-front',
  active: true,
  lock_profile: null,
  command_topic: null,
  unlock_payload: null,
  lock_payload: null,
  hold_seconds: null,
  ...over,
});

const ctx = { doorId: 7, doorCode: 'FRONT-01', did: 'did:ethr:sep:0xabc', eventId: 'evt-1' };

describe('lock profiles', () => {
  it('falls back to the door topic and native payload with no lock device', () => {
    const cmd = buildCommand(null, 'doors/front-01/cmd', ctx);
    expect(cmd.profile).toBe('native_json');
    expect(cmd.topic).toBe('doors/front-01/cmd');
    expect(cmd.release).toBeNull();
    const payload = JSON.parse(cmd.payload);
    expect(payload).toMatchObject({
      action: 'unlock', door_id: 7, door_code: 'FRONT-01', did: ctx.did, event_id: 'evt-1',
    });
  });

  it('prefers the device address over the door topic', () => {
    const cmd = buildCommand(lock({ lock_profile: 'native_json' }), 'doors/front-01/cmd', ctx);
    expect(cmd.topic).toBe('plug-front');
  });

  it('drives a Tasmota plug and schedules its release', () => {
    const cmd = buildCommand(lock({ lock_profile: 'tasmota', hold_seconds: 3 }), 'x', ctx);
    expect(cmd.topic).toBe('cmnd/plug-front/POWER');
    expect(cmd.payload).toBe('ON');
    expect(cmd.release).toEqual({ topic: 'cmnd/plug-front/POWER', payload: 'OFF', afterMs: 3000 });
  });

  it('drives a Shelly relay', () => {
    const cmd = buildCommand(lock({ lock_profile: 'shelly', address: 'shellyplug-s-AABBCC', hold_seconds: 5 }), 'x', ctx);
    expect(cmd.topic).toBe('shellyplug-s-AABBCC/relay/0/command');
    expect(cmd.payload).toBe('on');
    expect(cmd.release?.payload).toBe('off');
  });

  it('drives an ESPHome switch entity', () => {
    const cmd = buildCommand(
      lock({ lock_profile: 'esphome_switch', address: 'respeaker-door-ring/switch/strike', hold_seconds: 2 }),
      'x', ctx,
    );
    expect(cmd.topic).toBe('respeaker-door-ring/switch/strike/command');
    expect(cmd.payload).toBe('ON');
    expect(cmd.release?.afterMs).toBe(2000);
  });

  it('drives a Zigbee2MQTT device', () => {
    const cmd = buildCommand(lock({ lock_profile: 'zigbee2mqtt', address: 'front-relay', hold_seconds: 4 }), 'x', ctx);
    expect(cmd.topic).toBe('front-relay/set');
    expect(JSON.parse(cmd.payload)).toEqual({ state: 'ON' });
    expect(JSON.parse(cmd.release!.payload)).toEqual({ state: 'OFF' });
  });

  it('sends a custom payload verbatim', () => {
    const cmd = buildCommand(
      lock({
        lock_profile: 'custom',
        command_topic: 'site/gate/cmd',
        unlock_payload: 'OPEN:4',
        lock_payload: 'CLOSE',
        hold_seconds: 6,
      }),
      'x', ctx,
    );
    expect(cmd.topic).toBe('site/gate/cmd');
    expect(cmd.payload).toBe('OPEN:4');
    expect(cmd.release).toEqual({ topic: 'site/gate/cmd', payload: 'CLOSE', afterMs: 6000 });
  });

  it('never guesses a release for a custom lock with none configured', () => {
    const cmd = buildCommand(
      lock({ lock_profile: 'custom', command_topic: 'site/gate/cmd', unlock_payload: 'OPEN' }),
      'x', ctx,
    );
    expect(cmd.release).toBeNull();
  });

  it('lets command_topic override the derived topic', () => {
    const cmd = buildCommand(
      lock({ lock_profile: 'tasmota', command_topic: 'legacy/relay1' }),
      'x', ctx,
    );
    expect(cmd.topic).toBe('legacy/relay1');
    expect(cmd.release?.topic).toBe('legacy/relay1');
  });
});
