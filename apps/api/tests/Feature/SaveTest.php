<?php

namespace Tests\Feature;

use App\Models\GameProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SaveTest extends TestCase
{
    use RefreshDatabase;

    private function guest(): string
    {
        return $this->postJson('/api/v1/guest')->json('guest_token');
    }

    public function test_save_and_load_round_trip(): void
    {
        $t = $this->guest();
        $state = ['campaign' => ['completedOrder' => ['m001']], 'seed' => 5];
        $this->withHeader('X-Guest-Token', $t)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 5, 'state' => $state])
            ->assertCreated()->assertJsonPath('save.revision', 1);
        $this->withHeader('X-Guest-Token', $t)->getJson('/api/v1/save')
            ->assertOk()->assertJsonPath('save.state.campaign.completedOrder.0', 'm001');
    }

    public function test_optimistic_concurrency_rejects_a_stale_write(): void
    {
        $t = $this->guest();
        $h = ['X-Guest-Token' => $t];
        $this->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => ['a' => 1]]); // rev 1
        $this->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => ['a' => 2]]); // rev 2
        // client thinks it's still on rev 1
        $this->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => ['a' => 3], 'base_revision' => 1])
            ->assertStatus(409)->assertJsonPath('current.revision', 2);
    }

    public function test_schema_downgrade_is_refused(): void
    {
        $t = $this->guest();
        $h = ['X-Guest-Token' => $t];
        $this->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => ['a' => 1]]);
        $this->withHeaders($h)->putJson('/api/v1/save', ['schema_version' => 2, 'seed' => 1, 'state' => ['a' => 1]])
            ->assertStatus(409);
    }

    public function test_checkpoints_are_stored_and_listed(): void
    {
        $t = $this->guest();
        $h = ['X-Guest-Token' => $t];
        $this->withHeaders($h)->postJson('/api/v1/checkpoints', [
            'schema_version' => 3, 'seed' => 1, 'state' => ['x' => 1], 'checkpoint_type' => 'manual', 'label' => 'Before index',
        ])->assertCreated();
        $this->withHeaders($h)->getJson('/api/v1/checkpoints')->assertOk()->assertJsonCount(1, 'checkpoints');
    }

    public function test_requires_a_profile(): void
    {
        $this->putJson('/api/v1/save', ['schema_version' => 3, 'seed' => 1, 'state' => []])->assertStatus(401);
    }
}
