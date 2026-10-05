<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GameProfile;
use App\Models\GameSave;
use App\Services\ProfileService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SaveController extends Controller
{
    private function profile(Request $request): GameProfile
    {
        return $request->attributes->get('profile');
    }

    public function show(Request $request): \Illuminate\Http\JsonResponse
    {
        $save = $this->profile($request)->mainSave();
        if (! $save) {
            return response()->json(['save' => null]);
        }
        return response()->json(['save' => $this->serialize($save)]);
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'schema_version' => ['required', 'integer', 'max:' . ProfileService::SCHEMA_VERSION],
            'state' => ['required', 'array'],
            'seed' => ['required', 'integer'],
            'base_revision' => ['nullable', 'integer'],
            'company_name' => ['nullable', 'string', 'max:64'],
            'current_mission_id' => ['nullable', 'string', 'max:32'],
        ]);

        $profile = $this->profile($request);
        $current = $profile->mainSave();

        // optimistic concurrency: reject a stale write
        if ($current && $request->has('base_revision') && (int) $data['base_revision'] !== (int) $current->revision) {
            return response()->json([
                'message' => 'Save conflict: your base revision is stale.',
                'current' => $this->serialize($current),
            ], 409);
        }

        // never downgrade the schema version
        if ($current && $data['schema_version'] < $current->schema_version) {
            return response()->json(['message' => 'Cannot save an older schema version.'], 409);
        }

        $save = GameSave::create([
            'profile_id' => $profile->id,
            'schema_version' => $data['schema_version'],
            'revision' => ($current->revision ?? 0) + 1,
            'state_json' => json_encode($data['state']),
            'simulation_seed' => $data['seed'],
            'checkpoint_type' => 'main',
            'created_at' => now(),
        ]);

        $profile->fill(array_filter([
            'company_name' => $data['company_name'] ?? $profile->company_name,
            'current_mission_id' => $data['current_mission_id'] ?? $profile->current_mission_id,
        ]));
        $profile->campaign_state_json = $data['state']['campaign'] ?? $profile->campaign_state_json;
        $profile->save();

        // keep only the latest few main autosaves
        GameSave::where('profile_id', $profile->id)->where('checkpoint_type', 'main')
            ->orderByDesc('revision')->skip(5)->take(100)->get()->each->delete();

        return response()->json(['save' => $this->serialize($save)], 201);
    }

    public function checkpoints(Request $request): \Illuminate\Http\JsonResponse
    {
        $saves = GameSave::where('profile_id', $this->profile($request)->id)
            ->whereIn('checkpoint_type', ['manual', 'mission-start', 'pre-restore', 'auto'])
            ->orderByDesc('created_at')->limit(80)->get();
        return response()->json(['checkpoints' => $saves->map(fn ($s) => $this->serialize($s, false))]);
    }

    public function storeCheckpoint(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'schema_version' => ['required', 'integer', 'max:' . ProfileService::SCHEMA_VERSION],
            'state' => ['required', 'array'],
            'seed' => ['required', 'integer'],
            'checkpoint_type' => ['required', Rule::in(['manual', 'mission-start', 'pre-restore', 'auto'])],
            'label' => ['nullable', 'string', 'max:120'],
            'mission_id' => ['nullable', 'string', 'max:32'],
        ]);
        $profile = $this->profile($request);
        $save = GameSave::create([
            'profile_id' => $profile->id,
            'schema_version' => $data['schema_version'],
            'revision' => 0,
            'state_json' => json_encode($data['state']),
            'simulation_seed' => $data['seed'],
            'checkpoint_type' => $data['checkpoint_type'],
            'label' => $data['label'] ?? null,
            'mission_id' => $data['mission_id'] ?? null,
            'created_at' => now(),
        ]);
        return response()->json(['checkpoint' => $this->serialize($save)], 201);
    }

    public function showCheckpoint(Request $request, int $id): \Illuminate\Http\JsonResponse
    {
        $save = GameSave::where('profile_id', $this->profile($request)->id)->findOrFail($id);
        return response()->json(['checkpoint' => $this->serialize($save)]);
    }

    private function serialize(GameSave $s, bool $withState = true): array
    {
        $out = [
            'id' => $s->id,
            'schema_version' => $s->schema_version,
            'revision' => $s->revision,
            'seed' => (int) $s->simulation_seed,
            'checkpoint_type' => $s->checkpoint_type,
            'label' => $s->label,
            'mission_id' => $s->mission_id,
            'created_at' => optional($s->created_at)->toIso8601String(),
        ];
        if ($withState) {
            $out['state'] = json_decode($s->state_json, true);
        }
        return $out;
    }
}
