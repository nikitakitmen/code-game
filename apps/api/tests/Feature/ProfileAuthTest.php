<?php

namespace Tests\Feature;

use App\Models\GameProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Progress endpoints resolve the acting profile either from a guest token or from a Sanctum
 * bearer token. Both must work — a signed-in player must never be treated as "no profile".
 */
class ProfileAuthTest extends TestCase
{
    use RefreshDatabase;

    private function state(array $completed): array
    {
        return ['campaign' => ['completedOrder' => $completed, 'finished' => false], 'company' => ['name' => 'Acme']];
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => "Bearer {$token}"];
    }

    private function register(string $email = 'player@example.com', ?string $guestToken = null): string
    {
        return $this->flushHeaders()->postJson('/api/v1/auth/register', array_filter([
            'email' => $email, 'password' => 'supersecret', 'guest_token' => $guestToken,
        ]))->assertCreated()->json('token');
    }

    public function test_guest_token_resolves_a_guest_profile_for_profile_and_save(): void
    {
        $guest = $this->flushHeaders()->postJson('/api/v1/guest')->json('guest_token');
        $h = ['X-Guest-Token' => $guest];
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/profile')->assertOk()->assertJsonPath('profile.is_guest', true);
        $this->flushHeaders()->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => $this->state(['m001'])])->assertCreated();
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/save')->assertOk()->assertJsonPath('save.state.campaign.completedOrder.0', 'm001');
    }

    public function test_bearer_token_resolves_the_account_profile_on_every_progress_endpoint(): void
    {
        $h = $this->bearer($this->register());

        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/profile')->assertOk()->assertJsonPath('profile.is_guest', false);
        $this->flushHeaders()->withHeaders($h)->patchJson('/api/v1/profile', ['company_name' => 'Acme'])->assertOk();

        $this->flushHeaders()->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 7, 'state' => $this->state(['m001', 'm002'])])
            ->assertCreated()->assertJsonPath('save.revision', 1);
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/save')->assertOk()->assertJsonPath('save.state.campaign.completedOrder.1', 'm002');

        $this->flushHeaders()->withHeaders($h)->putJson('/api/v1/knowledge/progress', ['progress' => [['id' => 'db.index', 'state' => 'practiced', 'score' => 4]]])->assertOk();
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/knowledge/progress')->assertOk()->assertJsonPath('progress.0.state', 'practiced');

        $this->flushHeaders()->withHeaders($h)->postJson('/api/v1/achievements/unlocks', ['ids' => ['first-request']])->assertOk();
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/achievements/unlocks')->assertOk()->assertJsonPath('unlocked.0.id', 'first-request');

        $this->flushHeaders()->withHeaders($h)->putJson('/api/v1/settings', ['settings' => ['locale' => 'ru']])->assertOk();
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/settings')->assertOk()->assertJsonPath('settings.locale', 'ru');

        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/campaign')->assertOk()->assertJsonPath('completed.1', 'm002');
        $this->flushHeaders()->withHeaders($h)->postJson('/api/v1/checkpoints', ['schema_version' => 3, 'seed' => 7, 'state' => ['x' => 1], 'checkpoint_type' => 'manual'])->assertCreated();
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/checkpoints')->assertOk()->assertJsonCount(1, 'checkpoints');
        $id = $this->flushHeaders()->withHeaders($h)->postJson('/api/v1/missions/m001/attempts')->assertCreated()->json('attempt_id');
        $this->flushHeaders()->withHeaders($h)->patchJson("/api/v1/attempts/{$id}", ['result' => 'success'])->assertOk();
    }

    public function test_login_token_works_on_save(): void
    {
        $this->register();
        $token = $this->flushHeaders()->postJson('/api/v1/auth/login', ['email' => 'player@example.com', 'password' => 'supersecret'])->assertOk()->json('token');
        $this->flushHeaders()->withHeaders($this->bearer($token))->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => $this->state([])])->assertCreated();
    }

    public function test_bearer_save_uses_optimistic_concurrency(): void
    {
        $h = $this->bearer($this->register());
        $this->flushHeaders()->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => $this->state([]), 'base_revision' => 0])->assertCreated();
        $this->flushHeaders()->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => $this->state(['m001']), 'base_revision' => 1])->assertCreated();
        $this->flushHeaders()->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => $this->state(['m001']), 'base_revision' => 1])
            ->assertStatus(409)->assertJsonPath('current.revision', 2);
    }

    public function test_invalid_bearer_token_gets_401_not_someone_elses_profile(): void
    {
        $this->register();
        $this->flushHeaders()->withHeaders($this->bearer('1|not-a-real-token'))->getJson('/api/v1/profile')->assertStatus(401);
    }

    public function test_guest_progress_moves_into_the_new_account_on_register(): void
    {
        $guest = $this->flushHeaders()->postJson('/api/v1/guest')->json('guest_token');
        $g = ['X-Guest-Token' => $guest];
        $this->flushHeaders()->withHeaders($g)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 3, 'state' => $this->state(['m001', 'm002', 'm003']), 'company_name' => 'Acme', 'current_mission_id' => 'm004'])->assertCreated();
        $this->flushHeaders()->withHeaders($g)->putJson('/api/v1/knowledge/progress', ['progress' => [['id' => 'web.http', 'state' => 'understood', 'score' => 2]]])->assertOk();
        $this->flushHeaders()->withHeaders($g)->postJson('/api/v1/achievements/unlocks', ['ids' => ['first-request']])->assertOk();

        $h = $this->bearer($this->register('new@example.com', $guest));

        $this->assertNull(GameProfile::where('guest_token', $guest)->first());
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/profile')->assertOk()
            ->assertJsonPath('profile.is_guest', false)
            ->assertJsonPath('profile.company_name', 'Acme')
            ->assertJsonPath('profile.current_mission_id', 'm004');
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/save')->assertOk()->assertJsonCount(3, 'save.state.campaign.completedOrder');
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/knowledge/progress')->assertOk()->assertJsonPath('progress.0.id', 'web.http');
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/achievements/unlocks')->assertOk()->assertJsonPath('unlocked.0.id', 'first-request');
    }

    public function test_existing_account_and_guest_progress_report_a_conflict_and_merge_on_choice(): void
    {
        $h = $this->bearer($this->register());
        $this->flushHeaders()->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => $this->state(['m001'])])->assertCreated();

        $guest = $this->flushHeaders()->postJson('/api/v1/guest')->json('guest_token');
        $this->flushHeaders()->withHeaders(['X-Guest-Token' => $guest])->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 2, 'state' => $this->state(['m001', 'm002', 'm003', 'm004'])])->assertCreated();

        $login = $this->flushHeaders()->postJson('/api/v1/auth/login', ['email' => 'player@example.com', 'password' => 'supersecret', 'guest_token' => $guest])
            ->assertOk()->assertJsonPath('guest_conflict', true);
        $h2 = $this->bearer($login->json('token'));
        // nothing is overwritten until the player chooses
        $this->flushHeaders()->withHeaders($h2)->getJson('/api/v1/save')->assertOk()->assertJsonCount(1, 'save.state.campaign.completedOrder');

        $this->flushHeaders()->withHeaders($h2)->postJson('/api/v1/profile/merge-guest', ['guest_token' => $guest, 'strategy' => 'use_guest'])->assertOk();
        $this->flushHeaders()->withHeaders($h2)->getJson('/api/v1/save')->assertOk()->assertJsonCount(4, 'save.state.campaign.completedOrder');
        $this->assertNull(GameProfile::where('guest_token', $guest)->first());
    }

    public function test_keep_account_discards_the_guest(): void
    {
        $h = $this->bearer($this->register());
        $this->flushHeaders()->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => $this->state(['m001'])])->assertCreated();
        $guest = $this->flushHeaders()->postJson('/api/v1/guest')->json('guest_token');
        $this->flushHeaders()->withHeaders(['X-Guest-Token' => $guest])->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 2, 'state' => $this->state(['m001', 'm002'])])->assertCreated();
        $this->flushHeaders()->withHeaders($h)->postJson('/api/v1/profile/merge-guest', ['guest_token' => $guest, 'strategy' => 'keep_account'])->assertOk();
        $this->flushHeaders()->withHeaders($h)->getJson('/api/v1/save')->assertOk()->assertJsonCount(1, 'save.state.campaign.completedOrder');
        $this->assertNull(GameProfile::where('guest_token', $guest)->first());
    }
}
