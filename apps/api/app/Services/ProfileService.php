<?php

namespace App\Services;

use App\Models\AchievementUnlock;
use App\Models\GameProfile;
use App\Models\GameSave;
use App\Models\KnowledgeProgress;
use Illuminate\Support\Str;

class ProfileService
{
    public const SCHEMA_VERSION = 3;
    public const KNOWLEDGE_LEVELS = ['locked', 'discovered', 'understood', 'practiced', 'mastered'];

    public function createGuest(): GameProfile
    {
        return GameProfile::create([
            'guest_uuid' => (string) Str::uuid(),
            'guest_token' => Str::random(64),
        ]);
    }

    /**
     * Merge a guest profile's progress into a target (account) profile.
     * Meta-progress (knowledge, achievements) is taken at its maximum; the main
     * save is kept from whichever profile is further along (higher completed count).
     */
    public function mergeGuestInto(GameProfile $guest, GameProfile $target): void
    {
        // knowledge: keep the higher level/score
        foreach ($guest->knowledge as $gp) {
            $existing = KnowledgeProgress::firstOrNew([
                'profile_id' => $target->id,
                'knowledge_node_id' => $gp->knowledge_node_id,
            ]);
            $curLevel = array_search($existing->state ?? 'locked', self::KNOWLEDGE_LEVELS, true) ?: 0;
            $newLevel = array_search($gp->state, self::KNOWLEDGE_LEVELS, true) ?: 0;
            if ($newLevel >= $curLevel) {
                $existing->state = $gp->state;
            }
            $existing->score = max((int) ($existing->score ?? 0), (int) $gp->score);
            $existing->last_practiced_at = $gp->last_practiced_at ?? $existing->last_practiced_at;
            $existing->save();
        }

        // achievements: union
        foreach ($guest->unlocks as $u) {
            AchievementUnlock::firstOrCreate(
                ['profile_id' => $target->id, 'achievement_id' => $u->achievement_id],
                ['unlocked_at' => $u->unlocked_at]
            );
        }

        // main save: keep whichever is further along
        $guestMain = $guest->mainSave();
        $targetMain = $target->mainSave();
        if ($guestMain && $this->isFurther($guestMain, $targetMain)) {
            GameSave::create([
                'profile_id' => $target->id,
                'schema_version' => $guestMain->schema_version,
                'revision' => ($targetMain->revision ?? 0) + 1,
                'state_json' => $guestMain->state_json,
                'simulation_seed' => $guestMain->simulation_seed,
                'checkpoint_type' => 'main',
                'created_at' => now(),
            ]);
            if (! $target->company_name && $guest->company_name) {
                $target->company_name = $guest->company_name;
            }
            $target->current_mission_id = $guest->current_mission_id;
            $target->campaign_state_json = $guest->campaign_state_json;
            $target->save();
        }

        // guest is consumed
        $guest->delete();
    }

    private function isFurther(GameSave $a, ?GameSave $b): bool
    {
        if (! $b) {
            return true;
        }
        $ca = $this->completedCount($a);
        $cb = $this->completedCount($b);
        return $ca > $cb || ($ca === $cb && $a->revision > $b->revision);
    }

    private function completedCount(GameSave $save): int
    {
        $state = json_decode($save->state_json, true);
        return count($state['campaign']['completedOrder'] ?? []);
    }
}
