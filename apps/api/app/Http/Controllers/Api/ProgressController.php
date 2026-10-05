<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AchievementUnlock;
use App\Models\GameProfile;
use App\Models\KnowledgeProgress;
use App\Models\MissionAttempt;
use App\Services\ProfileService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ProgressController extends Controller
{
    private function profile(Request $request): GameProfile
    {
        return $request->attributes->get('profile');
    }

    public function profileShow(Request $request): \Illuminate\Http\JsonResponse
    {
        $p = $this->profile($request);
        return response()->json(['profile' => [
            'id' => $p->id,
            'is_guest' => $p->user_id === null,
            'company_name' => $p->company_name,
            'current_mission_id' => $p->current_mission_id,
            'settings' => $p->settings_json,
        ]]);
    }

    public function profileUpdate(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'company_name' => ['nullable', 'string', 'max:64'],
            'settings' => ['nullable', 'array'],
        ]);
        $p = $this->profile($request);
        if (array_key_exists('company_name', $data)) $p->company_name = $data['company_name'];
        if (array_key_exists('settings', $data)) $p->settings_json = $data['settings'];
        $p->save();
        return response()->json(['ok' => true]);
    }

    public function settingsShow(Request $request): \Illuminate\Http\JsonResponse
    {
        return response()->json(['settings' => $this->profile($request)->settings_json ?? ['locale' => 'en', 'volume' => 0.6, 'muted' => false, 'reduceMotion' => false]]);
    }

    public function settingsUpdate(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['settings' => ['required', 'array']]);
        $p = $this->profile($request);
        $p->settings_json = $data['settings'];
        $p->save();
        return response()->json(['ok' => true]);
    }

    public function campaign(Request $request): \Illuminate\Http\JsonResponse
    {
        $p = $this->profile($request);
        $save = $p->mainSave();
        $state = $save ? json_decode($save->state_json, true) : null;
        return response()->json([
            'current_mission_id' => $p->current_mission_id,
            'completed' => $state['campaign']['completedOrder'] ?? [],
            'finished' => $state['campaign']['finished'] ?? false,
        ]);
    }

    public function startAttempt(Request $request, string $slug): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['metrics_before' => ['nullable', 'array']]);
        $attempt = MissionAttempt::create([
            'profile_id' => $this->profile($request)->id,
            'mission_id' => $slug,
            'started_at' => now(),
            'metrics_before_json' => $data['metrics_before'] ?? null,
        ]);
        return response()->json(['attempt_id' => $attempt->id], 201);
    }

    public function updateAttempt(Request $request, int $id): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'result' => ['nullable', Rule::in(['success', 'abandoned'])],
            'selected_hypothesis' => ['nullable', 'string', 'max:40'],
            'decision_log' => ['nullable', 'array'],
            'metrics_after' => ['nullable', 'array'],
        ]);
        $attempt = MissionAttempt::where('profile_id', $this->profile($request)->id)->findOrFail($id);
        if (isset($data['result'])) {
            $attempt->result = $data['result'];
            $attempt->completed_at = now();
        }
        $attempt->selected_hypothesis = $data['selected_hypothesis'] ?? $attempt->selected_hypothesis;
        $attempt->decision_log_json = $data['decision_log'] ?? $attempt->decision_log_json;
        $attempt->metrics_after_json = $data['metrics_after'] ?? $attempt->metrics_after_json;
        $attempt->save();
        return response()->json(['ok' => true]);
    }

    public function knowledge(Request $request): \Illuminate\Http\JsonResponse
    {
        $rows = KnowledgeProgress::where('profile_id', $this->profile($request)->id)->get();
        return response()->json(['progress' => $rows->map(fn ($r) => [
            'id' => $r->knowledge_node_id, 'state' => $r->state, 'score' => $r->score,
        ])]);
    }

    public function updateKnowledge(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'progress' => ['required', 'array'],
            'progress.*.id' => ['required', 'string'],
            'progress.*.state' => ['required', Rule::in(ProfileService::KNOWLEDGE_LEVELS)],
            'progress.*.score' => ['nullable', 'integer', 'min:0'],
        ]);
        $pid = $this->profile($request)->id;
        foreach ($data['progress'] as $item) {
            $row = KnowledgeProgress::firstOrNew(['profile_id' => $pid, 'knowledge_node_id' => $item['id']]);
            // knowledge is monotonic: never lower the level
            $cur = array_search($row->state ?? 'locked', ProfileService::KNOWLEDGE_LEVELS, true) ?: 0;
            $new = array_search($item['state'], ProfileService::KNOWLEDGE_LEVELS, true) ?: 0;
            if ($new >= $cur) $row->state = $item['state'];
            $row->score = max((int) ($row->score ?? 0), (int) ($item['score'] ?? 0));
            $row->last_practiced_at = now();
            $row->save();
        }
        return response()->json(['ok' => true]);
    }

    public function achievements(Request $request): \Illuminate\Http\JsonResponse
    {
        $rows = AchievementUnlock::where('profile_id', $this->profile($request)->id)->get();
        return response()->json(['unlocked' => $rows->map(fn ($r) => ['id' => $r->achievement_id, 'at' => optional($r->unlocked_at)->toIso8601String()])]);
    }

    public function unlockAchievements(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate(['ids' => ['required', 'array'], 'ids.*' => ['string']]);
        $pid = $this->profile($request)->id;
        foreach ($data['ids'] as $aid) {
            AchievementUnlock::firstOrCreate(['profile_id' => $pid, 'achievement_id' => $aid], ['unlocked_at' => now()]);
        }
        return response()->json(['ok' => true]);
    }
}
