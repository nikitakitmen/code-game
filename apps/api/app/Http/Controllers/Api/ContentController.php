<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Achievement;
use App\Models\KnowledgeNode;
use App\Models\Mission;
use Illuminate\Http\Request;

class ContentController extends Controller
{
    public function missions(): \Illuminate\Http\JsonResponse
    {
        $index = Mission::where('enabled', true)->orderBy('order')
            ->get(['id', 'slug', 'act', 'order', 'title_key'])
            ->map(fn ($m) => [
                'id' => $m->id, 'slug' => $m->slug, 'act' => $m->act, 'order' => $m->order,
            ]);
        return response()->json(['missions' => $index]);
    }

    public function mission(string $slug): \Illuminate\Http\JsonResponse
    {
        $m = Mission::where('slug', $slug)->orWhere('id', $slug)->firstOrFail();
        return response()->json(['mission' => $m->definition_json]);
    }

    public function knowledge(): \Illuminate\Http\JsonResponse
    {
        return response()->json(['nodes' => KnowledgeNode::all()->map(fn ($n) => $n->definition_json)]);
    }

    public function achievements(): \Illuminate\Http\JsonResponse
    {
        return response()->json(['achievements' => Achievement::all()->map(fn ($a) => $a->definition_json)]);
    }

    public function locales(): \Illuminate\Http\JsonResponse
    {
        return response()->json(['locales' => ['en', 'ru'], 'default' => 'en']);
    }

    public function meta(): \Illuminate\Http\JsonResponse
    {
        return response()->json([
            'content_version' => '1.0.0',
            'schema_version' => \App\Services\ProfileService::SCHEMA_VERSION,
            'engine_version' => '1.0.0',
        ]);
    }
}
