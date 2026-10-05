<?php

namespace Tests\Feature;

use App\Models\Achievement;
use App\Models\GameProfile;
use App\Models\GameSave;
use App\Models\KnowledgeNode;
use App\Models\Mission;
use App\Models\User;
use App\Services\ProfileService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ProgressTest extends TestCase
{
    use RefreshDatabase;

    private function seedContent(): void
    {
        Mission::create(['id' => 'm001', 'act' => 1, 'slug' => 'boot', 'order' => 1, 'content_version' => '1.0.0', 'definition_json' => ['id' => 'm001', 'title' => ['en' => 'Boot', 'ru' => 'Загрузка']], 'enabled' => true]);
        Mission::create(['id' => 'm002', 'act' => 1, 'slug' => 'name', 'order' => 2, 'content_version' => '1.0.0', 'definition_json' => ['id' => 'm002'], 'enabled' => true]);
        KnowledgeNode::create(['id' => 'db.index', 'category' => 'db', 'definition_json' => ['id' => 'db.index']]);
        Achievement::create(['id' => 'first-request', 'slug' => 'first-request', 'definition_json' => ['id' => 'first-request']]);
    }

    public function test_content_endpoints(): void
    {
        $this->seedContent();
        $this->getJson('/api/v1/missions')->assertOk()->assertJsonCount(2, 'missions');
        $this->getJson('/api/v1/missions/boot')->assertOk()->assertJsonPath('mission.id', 'm001');
        $this->getJson('/api/v1/knowledge')->assertOk()->assertJsonCount(1, 'nodes');
        $this->getJson('/api/v1/achievements')->assertOk()->assertJsonCount(1, 'achievements');
        $this->getJson('/api/v1/locales')->assertOk()->assertJsonPath('locales.0', 'en');
    }

    public function test_knowledge_progress_is_monotonic(): void
    {
        $t = $this->postJson('/api/v1/guest')->json('guest_token');
        $h = ['X-Guest-Token' => $t];
        $this->withHeaders($h)->putJson('/api/v1/knowledge/progress', ['progress' => [['id' => 'db.index', 'state' => 'practiced', 'score' => 5]]])->assertOk();
        // try to lower it — should be ignored
        $this->withHeaders($h)->putJson('/api/v1/knowledge/progress', ['progress' => [['id' => 'db.index', 'state' => 'discovered', 'score' => 1]]])->assertOk();
        $this->withHeaders($h)->getJson('/api/v1/knowledge/progress')->assertOk()
            ->assertJsonPath('progress.0.state', 'practiced')
            ->assertJsonPath('progress.0.score', 5);
    }

    public function test_achievement_unlock_is_idempotent(): void
    {
        $t = $this->postJson('/api/v1/guest')->json('guest_token');
        $h = ['X-Guest-Token' => $t];
        $this->withHeaders($h)->postJson('/api/v1/achievements/unlocks', ['ids' => ['first-request']])->assertOk();
        $this->withHeaders($h)->postJson('/api/v1/achievements/unlocks', ['ids' => ['first-request']])->assertOk();
        $this->assertDatabaseCount('achievement_unlocks', 1);
    }

    public function test_mission_attempt_lifecycle(): void
    {
        $t = $this->postJson('/api/v1/guest')->json('guest_token');
        $h = ['X-Guest-Token' => $t];
        $id = $this->withHeaders($h)->postJson('/api/v1/missions/m029/attempts', ['metrics_before' => ['p95' => 1200]])->json('attempt_id');
        $this->withHeaders($h)->patchJson("/api/v1/attempts/{$id}", [
            'result' => 'success', 'selected_hypothesis' => 'h1', 'metrics_after' => ['p95' => 120],
        ])->assertOk();
        $this->assertDatabaseHas('mission_attempts', ['id' => $id, 'result' => 'success', 'selected_hypothesis' => 'h1']);
    }

    public function test_guest_to_account_merge_keeps_the_furthest_save_and_unions_knowledge(): void
    {
        // account with a short save
        $user = User::create(['email' => 'u@example.com', 'password_hash' => Hash::make('supersecret')]);
        $account = GameProfile::create(['user_id' => $user->id]);
        GameSave::create(['profile_id' => $account->id, 'schema_version' => 3, 'revision' => 1, 'state_json' => json_encode(['campaign' => ['completedOrder' => ['m001']]]), 'simulation_seed' => 1, 'checkpoint_type' => 'main', 'created_at' => now()]);

        // guest further along + extra knowledge
        $guest = GameProfile::create(['guest_uuid' => '11111111-1111-1111-1111-111111111111', 'guest_token' => str_repeat('g', 64)]);
        GameSave::create(['profile_id' => $guest->id, 'schema_version' => 3, 'revision' => 1, 'state_json' => json_encode(['campaign' => ['completedOrder' => ['m001', 'm002', 'm003']]]), 'simulation_seed' => 2, 'checkpoint_type' => 'main', 'created_at' => now()]);
        $guest->knowledge()->create(['knowledge_node_id' => 'db.index', 'state' => 'mastered', 'score' => 9]);

        app(ProfileService::class)->mergeGuestInto($guest, $account->fresh());

        $this->assertDatabaseMissing('game_profiles', ['id' => $guest->id]);
        $this->assertCount(3, json_decode($account->fresh()->mainSave()->state_json, true)['campaign']['completedOrder']);
        $this->assertDatabaseHas('knowledge_progress', ['profile_id' => $account->id, 'knowledge_node_id' => 'db.index', 'state' => 'mastered']);
    }
}
